using System.Text.Json.Nodes;
using System.Collections.ObjectModel;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

public sealed partial class MainViewModel : ObservableObject, IDisposable
{
    private readonly AppSettings _settings;
    private readonly EpgService _epg = new();
    private readonly DispatcherTimer _epgTimer;
    private readonly DispatcherTimer _numberTimer;
    private readonly DispatcherTimer _toastTimer;
    private readonly DispatcherTimer _saveTimer;

    private XtreamClient? _client;
    private List<Channel> _all = [];
    private List<Category> _liveCats = [];
    // Liste così come arrivano dal server: servono a rifare il filtro quando si cambia "Nascondi XXX".
    private (List<Category> Cats, List<ChannelData> Items)? _rawLive;
    private Dictionary<int, Channel> _byId = [];
    private Channel? _previous;
    private CancellationTokenSource? _refreshCts;
    private string _numberBuffer = "";
    private bool _suspendFilter;
    private readonly Dictionary<LibraryMode, string?> _modeCategory = [];

    public MainViewModel(AppSettings settings)
    {
        _settings = settings;
        Player = new PlayerService(settings);
        Player.StateChanged += OnPlaybackChanged;
        Player.Ended += OnPlayerEnded;
        Player.Failed += () => PlaybackError = "Impossibile riprodurre questo contenuto.\nIl file potrebbe non essere più disponibile sul server.";

        _volume = settings.Volume;
        _isMuted = settings.Muted;
        Player.Volume = settings.Volume;
        Player.Muted = settings.Muted;

        _epgTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        _epgTimer.Tick += (_, _) => UpdateAllEpg();
        _epgTimer.Start();

        _numberTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1400) };
        _numberTimer.Tick += (_, _) => CommitNumber();

        _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3.2) };
        _toastTimer.Tick += (_, _) => { _toastTimer.Stop(); Toast = null; };

        _saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800) };
        _saveTimer.Tick += (_, _) => { _saveTimer.Stop(); SettingsService.Save(_settings); };

        InitLibrary();
        InitTv();
        InitUpdates();
        InitDownloads();
        InitServer();
        InitDiscover();
    }

    public PlayerService Player { get; }
    public AppSettings Settings => _settings;
    public ObservableCollection<CategoryItem> Categories { get; } = [];

    /// <summary>La vista mostra il banner informativo quando parte un canale, un film o un episodio.</summary>
    public event Action<object>? MediaStarted;

    // ---------- Stato ----------

    [ObservableProperty] private LibraryMode _mode = LibraryMode.Live;
    [ObservableProperty] private IReadOnlyList<Channel> _visibleChannels = [];
    [ObservableProperty] private CategoryItem? _selectedCategory;
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private Channel? _currentChannel;
    [ObservableProperty] private Programme? _currentNow;
    [ObservableProperty] private Programme? _currentNext;
    [ObservableProperty] private double _currentProgress;

    [ObservableProperty] private bool _isLoggedIn;
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string? _busyText;
    [ObservableProperty] private string? _loginError;
    [ObservableProperty] private string _loginServer = "";
    [ObservableProperty] private string _loginUsername = "";
    [ObservableProperty] private bool _isRefreshing;
    [ObservableProperty] private string? _accountInfo;
    [ObservableProperty] private string? _listInfo;

    [ObservableProperty] private string? _toast;
    [ObservableProperty] private string? _numberEntry;
    [ObservableProperty] private bool _isSettingsOpen;

    [ObservableProperty] private int _volume;
    [ObservableProperty] private bool _isMuted;

    [ObservableProperty] private bool _isIdle = true;
    [ObservableProperty] private bool _isPlaybackBusy;
    [ObservableProperty] private bool _isVideoCovered;
    [ObservableProperty] private bool _showIdlePlaceholder = true;
    [ObservableProperty] private bool _isPlaying;
    [ObservableProperty] private bool _isPaused;
    [ObservableProperty] private string _playPauseGlyph = "";
    [ObservableProperty] private string? _playbackMessage;
    [ObservableProperty] private string? _playbackError;

    /// <summary>Titolo e sottotitolo di ciò che è in riproduzione (barra del titolo e comandi).</summary>
    [ObservableProperty] private string? _nowPlayingTitle;
    [ObservableProperty] private string? _nowPlayingSubtitle;

    public string Version => UpdateService.CurrentVersionText;

    /// <summary>"Aggiornata …" vale per la lista canali: nel piè di pagina solo nella sezione TV.</summary>
    public string? FooterInfo => Mode == LibraryMode.Live ? ListInfo : null;

    partial void OnListInfoChanged(string? value) => OnPropertyChanged(nameof(FooterInfo));

    // Impostabili: le schede TV / Film / Serie sono RadioButton legati in due direzioni.
    public bool IsLiveMode { get => Mode == LibraryMode.Live; set { if (value) Mode = LibraryMode.Live; } }
    public bool IsMoviesMode { get => Mode == LibraryMode.Movies; set { if (value) Mode = LibraryMode.Movies; } }
    public bool IsSeriesMode { get => Mode == LibraryMode.Series; set { if (value) Mode = LibraryMode.Series; } }

    /// <summary>Elementi mostrati ora nel pannello: risultati, categorie o contenuti della categoria aperta.</summary>
    public int VisibleCount => IsSearchActive ? SearchHitCount
        : SelectedCategory == null ? Categories.Count
        : Mode switch
        {
            LibraryMode.Movies => VisibleMovies.Count,
            LibraryMode.Series => VisibleSeries.Count,
            _ => VisibleChannels.Count,
        };

    public string ItemCountText
    {
        get
        {
            var n = VisibleCount;
            if (IsSearchActive) return n == 1 ? "1 risultato" : $"{n} risultati";
            if (SelectedCategory == null) return n == 1 ? "1 categoria" : $"{n} categorie";
            return Mode switch
            {
                LibraryMode.Movies => n == 1 ? "1 film" : $"{n} film",
                LibraryMode.Series => n == 1 ? "1 serie" : $"{n} serie",
                _ => n == 1 ? "1 canale" : $"{n} canali",
            };
        }
    }

    public string SearchPlaceholder => SearchScope switch
    {
        SearchScope.Channels => "Cerca canali   (Ctrl+F)",
        SearchScope.Movies => "Cerca film   (Ctrl+F)",
        SearchScope.Series => "Cerca serie   (Ctrl+F)",
        _ => "Cerca canali, film e serie   (Ctrl+F)",
    };

    // Cosa mostra il pannello: elenco categorie, contenuti della categoria o risultati di ricerca.
    public bool IsSearchActive => !string.IsNullOrWhiteSpace(SearchText);
    public bool IsCategoryOpen => SelectedCategory != null;
    public bool ShowCategoryList => !IsSearchActive && !IsCategoryOpen;
    public bool ShowChannelList => !IsSearchActive && IsCategoryOpen && !IsGridView && Mode == LibraryMode.Live;
    public bool ShowMovieList => !IsSearchActive && IsCategoryOpen && !IsGridView && Mode == LibraryMode.Movies;
    public bool ShowSeriesList => !IsSearchActive && IsCategoryOpen && !IsGridView && Mode == LibraryMode.Series;
    public bool ShowCategoryHeader => !IsSearchActive && IsCategoryOpen;

    private void UpdateViewFlags()
    {
        OnPropertyChanged(nameof(IsSearchActive));
        OnPropertyChanged(nameof(IsCategoryOpen));
        OnPropertyChanged(nameof(ShowCategoryList));
        OnPropertyChanged(nameof(ShowChannelList));
        OnPropertyChanged(nameof(ShowMovieList));
        OnPropertyChanged(nameof(ShowSeriesList));
        OnPropertyChanged(nameof(ShowCategoryHeader));
        OnPropertyChanged(nameof(ShowGridList));
        NotifyCounts();
    }

    // ---------- Avvio / account ----------

    public async Task InitializeAsync()
    {
        LoginServer = _settings.Server ?? "";
        LoginUsername = _settings.Username ?? "";
        LoadBrowsePrefs();
        RefreshSavedLists();

        var password = _settings.HasAccount ? SettingsService.Unprotect(_settings.ProtectedPassword) : null;
        if (password == null) { IsLoggedIn = false; return; }

        _client = new XtreamClient(new XtreamAccount(_settings.Server!, _settings.Username!, password));
        IsLoggedIn = true;

        var cache = await Task.Run(() => CacheService.Load(_client.Account.Key));
        if (cache is { Channels.Count: > 0 })
        {
            Populate(cache.Categories, cache.Channels);
            ListInfo = $"Aggiornata {FormatAge(cache.SavedAt)}";
            AutoPlay();
            _ = LoadEpgAsync(force: false);
            PrewarmCatalog();
            await RefreshAsync(userInitiated: false);
        }
        else
        {
            BusyText = "Caricamento canali…";
            IsBusy = true;
            var ok = await RefreshAsync(userInitiated: false);
            IsBusy = false;
            if (ok) AutoPlay();
        }
    }

    private void AutoPlay()
    {
        if (!_settings.AutoPlayLastChannel || CurrentChannel != null || IsVod || _profilesPending || IsProfilePickerOpen) return;
        if (_settings.LastStreamId is int id && _byId.TryGetValue(id, out var ch)) PlayChannel(ch);
    }

    public async Task LoginAsync(string password)
    {
        LoginError = null;
        var (server, urlUser, urlPass) = XtreamClient.ParseServerInput(LoginServer);
        var user = string.IsNullOrWhiteSpace(LoginUsername) ? urlUser : LoginUsername.Trim();
        var pass = string.IsNullOrEmpty(password) ? urlPass : password;

        if (string.IsNullOrWhiteSpace(server)) { LoginError = "Inserisci l'indirizzo del server."; return; }
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrEmpty(pass)) { LoginError = "Inserisci nome utente e password."; return; }

        IsBusy = true;
        BusyText = "Accesso in corso…";
        if (_settings.HomeServer is { } home)
        {
            // Col server di casa la lista nuova va sul server, che la usa per tutti i dispositivi.
            try
            {
                await ServerApi.SendXtreamAsync(home, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "", new XtreamAccount(server, user, pass), LoginAlias.Trim());
                LoginAlias = "";
                await ReloadFromServerAsync(null);
            }
            catch (ServerException ex) { LoginError = ex.Message; }
            finally { IsBusy = false; }
            return;
        }
        try
        {
            var client = new XtreamClient(new XtreamAccount(server, user, pass));
            var auth = await client.AuthenticateAsync(CancellationToken.None);
            BusyText = "Caricamento canali…";
            var cats = await client.GetLiveCategoriesAsync(CancellationToken.None);
            var chans = await client.GetLiveStreamsAsync(CancellationToken.None);

            _settings.Server = server;
            _settings.Username = user;
            _settings.ProtectedPassword = SettingsService.Protect(pass);
            SaveList(server, user, _settings.ProtectedPassword, auth);
            await Task.Run(() => CacheService.Save(client.Account.Key, new ChannelCache { SavedAt = DateTimeOffset.Now, Categories = cats, Channels = chans }));

            _client = client;
            LoginServer = server;
            LoginUsername = user;
            SetAccountInfo(auth);
            Populate(cats, chans);
            ListInfo = "Aggiornata ora";
            IsLoggedIn = true;

            if (chans.Count == 0)
            {
                // Account solo on-demand: si parte direttamente dai film.
                Mode = LibraryMode.Movies;
                return;
            }
            var first = _all.FirstOrDefault();
            if (first != null) PlayChannel(first);
            _ = LoadEpgAsync(force: false);
        }
        catch (XtreamException ex)
        {
            LoginError = ex.Message;
        }
        catch (Exception ex)
        {
            Log.Write("Login fallito", ex);
            LoginError = "Errore imprevisto: " + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private void Logout()
    {
        // Collegato al server di casa: si scollega e torna l'account IPTV di prima (da reinserire la password).
        if (_settings.HomeServer is { } url)
        {
            _ = ServerApi.LogoutAsync(url, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "");
            _pendingOps.Clear();
            RestoreOwnAccount();
            _restoredPassword = null;
            ServerNetwork = null;
        }
        ResetSession();
    }

    /// <summary>Chiude l'account aperto: niente riproduzione, liste vuote, schermata di accesso.</summary>
    private void ResetSession()
    {
        _refreshCts?.Cancel();
        ExitTvMode();
        _modeCategory.Clear();
        LeaveVod();
        Player.Stop();
        if (CurrentChannel != null) CurrentChannel.IsPlaying = false;
        CurrentChannel = null;
        NowPlayingTitle = NowPlayingSubtitle = null;
        _previous = null;
        _client = null;
        _all = [];
        _rawLive = null;
        _byId = [];
        _liveCats = [];
        ResetLibrary();
        Categories.Clear();
        VisibleChannels = [];
        Mode = LibraryMode.Live;
        _settings.ProtectedPassword = null;
        _settings.LastStreamId = null;
        SettingsService.Save(_settings);
        IsSettingsOpen = false;
        AccountInfo = null;
        IsLoggedIn = false;
    }

    [RelayCommand]
    private Task Refresh() => Mode switch
    {
        LibraryMode.Movies => ReloadMoviesAsync(),
        LibraryMode.Series => ReloadSeriesAsync(),
        _ => RefreshAsync(userInitiated: true),
    };

    private async Task<bool> RefreshAsync(bool userInitiated)
    {
        if (_client == null) return false;
        _refreshCts?.Cancel();
        var cts = _refreshCts = new CancellationTokenSource();
        var client = _client;
        IsRefreshing = true;
        try
        {
            var auth = await client.AuthenticateAsync(cts.Token);
            SetAccountInfo(auth);
            var cats = await client.GetLiveCategoriesAsync(cts.Token);
            var chans = await client.GetLiveStreamsAsync(cts.Token);
            if (cts.IsCancellationRequested || client != _client) return false;
            if (chans.Count == 0 && _all.Count > 0) { ShowToast("Il server non ha restituito canali"); return true; }

            _ = Task.Run(() => CacheService.Save(client.Account.Key, new ChannelCache { SavedAt = DateTimeOffset.Now, Categories = cats, Channels = chans }));
            Populate(cats, chans);
            ListInfo = "Aggiornata ora";
            if (userInitiated) ShowToast($"Lista aggiornata · {chans.Count} canali");
            _ = LoadEpgAsync(force: userInitiated);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (XtreamException ex)
        {
            if (_all.Count == 0)
            {
                if (ex.IsAuthError) { ResetSession(); LoginError = ex.Message; }
                else ShowToast(ex.Message);
            }
            else
            {
                ShowToast(ex.IsAuthError ? ex.Message : "Server non raggiungibile: uso la lista salvata");
            }
            return false;
        }
        finally
        {
            if (_refreshCts == cts) IsRefreshing = false;
        }
    }

    private void SetAccountInfo(AuthInfo auth)
    {
        UpdateListExpiry(auth);
        AccountInfo = auth.ExpiresAt is { } exp
            ? $"Account attivo · scade il {exp.ToLocalTime():dd/MM/yyyy}"
            : "Account attivo · nessuna scadenza";
    }

    private static string FormatAge(DateTimeOffset at)
    {
        var age = DateTimeOffset.Now - at;
        if (age < TimeSpan.FromMinutes(2)) return "ora";
        if (age < TimeSpan.FromHours(1)) return $"{(int)age.TotalMinutes} min fa";
        if (age < TimeSpan.FromDays(1)) return $"{(int)age.TotalHours} h fa";
        return $"il {at.ToLocalTime():dd/MM}";
    }

    // ---------- Sezioni e categorie ----------

    partial void OnModeChanged(LibraryMode value)
    {
        OnPropertyChanged(nameof(IsSingleChannelList));
        _suspendFilter = true;
        SearchText = "";
        _suspendFilter = false;
        OpenSeries = null;
        IsSettingsOpen = false;
        IsDownloadsOpen = false;
        // "TV" dal pannello: si lasciano "Film e serie" e "La mia lista".
        if (value == LibraryMode.Live) { ShowDiscover = false; _myListOpen = false; }
        OnPropertyChanged(nameof(IsLiveMode));
        OnPropertyChanged(nameof(IsMoviesMode));
        OnPropertyChanged(nameof(IsSeriesMode));
        OnPropertyChanged(nameof(IsDiscoverMode));
        OnPropertyChanged(nameof(IsMyListMode));
        OnPropertyChanged(nameof(ShowKindSwitch));
        OnPropertyChanged(nameof(FooterInfo));
        LoadBrowsePrefs();
        RebuildCategories();
        ApplyFilter();
        UpdateViewFlags();
        if (value == LibraryMode.Movies) _ = EnsureMoviesAsync();
        else if (value == LibraryMode.Series) _ = EnsureSeriesAsync();
    }

    [RelayCommand]
    private void SetMode(LibraryMode mode) => Mode = mode;

    private void RebuildCategories()
    {
        _suspendFilter = true;
        Categories.Clear();
        switch (Mode)
        {
            case LibraryMode.Live:
                if (_all.Count > 0 && _settings.SingleChannelList)
                {
                    // Elenco unico: solo "Tutti", già aperto.
                    Categories.Add(new CategoryItem(CategoryItem.AllId, "Tutti i canali") { Count = _all.Count });
                    _modeCategory[Mode] = CategoryItem.AllId;
                }
                else if (_all.Count > 0)
                {
                    Categories.Add(new CategoryItem(CategoryItem.FavoritesId, "Preferiti") { Count = _all.Count(c => c.IsFavorite) });
                    Categories.Add(new CategoryItem(CategoryItem.AllId, "Tutti") { Count = _all.Count });
                    AddCategories(_liveCats, _all.Select(c => c.CategoryId));
                }
                break;
            case LibraryMode.Movies:
                AddLibraryCategories(_vodCats, _movies.Select(m => m.CategoryId), _movies.Count, _movies.Count(m => m.HasProgress), _movies.Count(m => _positions.InMyList(m.Key)));
                break;
            case LibraryMode.Series:
                AddLibraryCategories(_seriesCats, _series.Select(s => s.CategoryId), _series.Count, _series.Count(s => s.HasProgress), _series.Count(s => _positions.InMyList(s.Key)));
                break;
        }
        // Prima si sceglie la categoria: resta aperta solo quella scelta in questa sessione.
        var wanted = _modeCategory.GetValueOrDefault(Mode);
        SelectedCategory = wanted == null ? null : Categories.FirstOrDefault(c => c.Id == wanted);
        _suspendFilter = false;
        UpdateViewFlags();
        OnCategoriesRebuilt();
    }

    private void AddLibraryCategories(List<Category> cats, IEnumerable<string?> ids, int total, int inProgress, int inMyList)
    {
        if (total == 0) return;
        if (inProgress > 0) Categories.Add(new CategoryItem(CategoryItem.ContinueId, "Continua a guardare") { Count = inProgress });
        if (inMyList > 0) Categories.Add(new CategoryItem(CategoryItem.MyListId, "La mia lista") { Count = inMyList });
        Categories.Add(new CategoryItem(CategoryItem.AllId, "Tutti") { Count = total });
        AddCategories(cats, ids);
    }

    private void AddCategories(List<Category> cats, IEnumerable<string?> ids)
    {
        var counts = ids.Where(id => id != null).GroupBy(id => id!).ToDictionary(g => g.Key, g => g.Count());
        foreach (var c in cats)
            if (counts.TryGetValue(c.Id, out var n))
                Categories.Add(new CategoryItem(c.Id, c.Name) { Count = n });
    }

    // ---------- Lista canali ----------

    private void Populate(List<Category> cats, List<ChannelData> chans)
    {
        var currentId = CurrentChannel?.StreamId;
        var previousId = _previous?.StreamId;

        _rawLive = (cats, chans);
        (cats, chans) = WithoutHidden(cats, chans, c => c.CategoryId);
        _liveCats = cats;
        // Lo stesso canale in più qualità ("Rai 1 FHD", "Rai 1 HD", "Rai 1 4K") diventa uno solo, "Rai 1", dentro
        // la sua categoria. Resta in testa la versione nei preferiti, altrimenti la prima della lista.
        // Elenco unico: lo stesso canale si unisce anche tra categorie diverse e parte dalla qualità migliore;
        // se il flusso si blocca il player gira sulle altre, dalla migliore alla peggiore.
        var single = _settings.SingleChannelList;
        _all = chans
            .GroupBy(c => c.StreamId).Select(g => g.First())
            .GroupBy(c => (single ? null : c.CategoryId, TextHelpers.ChannelKey(c.Name)))
            .Select(g =>
            {
                var list = single ? g.OrderByDescending(d => TextHelpers.QualityRank(d.Name)).ToList() : g.ToList();
                if (list.Count == 1) return new Channel(list[0]) { IsFavorite = _settings.Favorites.Contains(list[0].StreamId) };
                if (single)
                    return new Channel(list[0], TextHelpers.WithoutQuality(list[0].Name), list.Skip(1).ToList())
                        { IsFavorite = list.Any(d => _settings.Favorites.Contains(d.StreamId)) };
                var main = list.FirstOrDefault(d => _settings.Favorites.Contains(d.StreamId)) ?? list[0];
                return new Channel(main, TextHelpers.WithoutQuality(main.Name), list.Where(d => d != main).ToList())
                    { IsFavorite = _settings.Favorites.Contains(main.StreamId) };
            })
            .ToList();
        _byId = new Dictionary<int, Channel>();
        foreach (var c in _all)
        {
            _byId[c.StreamId] = c;
            foreach (var a in c.Alternates) _byId.TryAdd(a, c);
        }

        if (currentId is int cid && _byId.TryGetValue(cid, out var cur))
        {
            cur.IsPlaying = !IsVod;
            CurrentChannel = cur;
        }
        _previous = previousId is int pid ? _byId.GetValueOrDefault(pid) : null;

        if (Mode == LibraryMode.Live)
        {
            RebuildCategories();
            ApplyFilter();
        }
        UpdateAllEpg();
    }

    partial void OnSelectedCategoryChanged(CategoryItem? value)
    {
        if (!_suspendFilter) _modeCategory[Mode] = value?.Id;
        ApplyFilter();
        UpdateViewFlags();
    }

    [RelayCommand]
    private void OpenCategory(CategoryItem? c)
    {
        if (c != null) SelectedCategory = c;
    }

    [RelayCommand]
    private void CloseCategory()
    {
        if (!IsSingleChannelList) SelectedCategory = null;
    }

    /// <summary>TV in diretta con l'elenco unico: niente categorie a cui tornare.</summary>
    public bool IsSingleChannelList => Mode == LibraryMode.Live && _settings.SingleChannelList;

    public bool SingleChannelList
    {
        get => _settings.SingleChannelList;
        set
        {
            if (_settings.SingleChannelList == value) return;
            _settings.SingleChannelList = value;
            if (!value && Mode == LibraryMode.Live) _modeCategory[Mode] = null;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsSingleChannelList));
            ScheduleSave();
            ReapplyHidden();
            if (IsTvMode && Mode == LibraryMode.Live) ShowTvCategories(0);
        }
    }

    partial void OnSearchTextChanged(string value)
    {
        if (OpenSeries != null && !string.IsNullOrEmpty(value)) OpenSeries = null;
        RunSearch();
        UpdateViewFlags();
    }

    partial void OnVisibleChannelsChanged(IReadOnlyList<Channel> value) => NotifyCounts();

    private void NotifyCounts()
    {
        OnPropertyChanged(nameof(VisibleCount));
        OnPropertyChanged(nameof(ItemCountText));
    }

    private void ApplyFilter()
    {
        if (_suspendFilter) return;
        var cat = SelectedCategory;
        switch (Mode)
        {
            case LibraryMode.Movies:
                VisibleMovies = cat == null ? []
                    : GroupVariants(SortMovies(FilterLibrary(_movies, cat, m => m.CategoryId, m => m.HasProgress, m => _positions.GetUpdatedAt(m.Key), m => m.Key)));
                break;
            case LibraryMode.Series:
                VisibleSeries = cat == null ? []
                    : GroupVariants(SortSeries(FilterLibrary(_series, cat, s => s.CategoryId, s => s.HasProgress, s => _positions.GetLastEpisode(s.SeriesId)?.UpdatedAt, s => s.Key)));
                break;
            default:
                VisibleChannels = cat == null ? []
                    : SortChannels(cat.IsFavorites ? _all.Where(c => c.IsFavorite).ToList()
                        : cat.Id == CategoryItem.AllId ? _all
                        : _all.Where(c => c.CategoryId == cat.Id).ToList());
                // Elenco unico: i preferiti restano in cima, nell'ordine scelto.
                if (cat?.Id == CategoryItem.AllId && _settings.SingleChannelList)
                    VisibleChannels = [.. VisibleChannels.Where(c => c.IsFavorite), .. VisibleChannels.Where(c => !c.IsFavorite)];
                break;
        }
        BuildGridRows();
    }

    private List<T> FilterLibrary<T>(List<T> all, CategoryItem cat, Func<T, string?> catId,
        Func<T, bool> inProgress, Func<T, DateTimeOffset?> lastWatched, Func<T, string> key)
    {
        if (cat.Id == CategoryItem.AllId) return all;
        if (cat.IsContinue) return all.Where(inProgress).OrderByDescending(x => lastWatched(x) ?? DateTimeOffset.MinValue).ToList();
        if (cat.IsMyList) return all.Where(x => _positions.InMyList(key(x))).OrderByDescending(x => _positions.MyListAddedAt(key(x))).ToList();
        return all.Where(x => catId(x) == cat.Id).ToList();
    }

    [RelayCommand]
    private void ClearSearch() => SearchText = "";

    [RelayCommand]
    private void ToggleFavorite(Channel? ch)
    {
        ch ??= IsVod ? null : CurrentChannel;
        if (ch == null) return;
        ch.IsFavorite = !ch.IsFavorite;
        if (ch.IsFavorite) _settings.Favorites.Add(ch.StreamId);
        else
        {
            _settings.Favorites.Remove(ch.StreamId);
            // Elenco unico: il preferito poteva essere un'altra qualità dello stesso canale.
            foreach (var a in ch.Alternates)
                if (_settings.Favorites.Remove(a))
                    QueueServerOp(new System.Text.Json.Nodes.JsonObject { ["op"] = "favorite", ["streamId"] = a, ["on"] = false });
        }
        ScheduleSave();
        QueueServerOp(new System.Text.Json.Nodes.JsonObject { ["op"] = "favorite", ["streamId"] = ch.StreamId, ["on"] = ch.IsFavorite }, now: true);

        if (Mode == LibraryMode.Live)
        {
            var fav = Categories.FirstOrDefault(c => c.IsFavorites);
            if (fav != null) fav.Count = _all.Count(c => c.IsFavorite);
            if (SelectedCategory?.IsFavorites == true || IsSingleChannelList) ApplyFilter();
        }
        ShowToast(ch.IsFavorite ? $"{ch.Name} aggiunto ai preferiti" : $"{ch.Name} rimosso dai preferiti");
    }

    // ---------- Riproduzione TV ----------

    [RelayCommand]
    public void PlayChannel(Channel? ch)
    {
        if (ch == null || _client == null) return;
        if (ch == CurrentChannel && Player.IsActive && !IsVod)
        {
            MediaStarted?.Invoke(ch);
            return;
        }

        LeaveVod();
        if (CurrentChannel != null && CurrentChannel != ch)
        {
            CurrentChannel.IsPlaying = false;
            _previous = CurrentChannel;
        }
        CurrentChannel = ch;
        ch.IsPlaying = true;
        NowPlayingTitle = ch.Name;
        PlayLive(ch);

        _settings.LastStreamId = ch.StreamId;
        ScheduleSave();
        UpdateCurrentEpg();
        _ = EnsureShortEpgAsync(ch);
        MediaStarted?.Invoke(ch);
    }

    [RelayCommand]
    private void NextChannel() => Zap(+1);

    [RelayCommand]
    private void PreviousChannel() => Zap(-1);

    private void Zap(int dir)
    {
        if (IsVod) return;
        var list = CurrentChannel != null && VisibleChannels.Contains(CurrentChannel) ? VisibleChannels : (IReadOnlyList<Channel>)_all;
        if (list.Count == 0) return;
        var idx = CurrentChannel == null ? -1 : IndexOf(list, CurrentChannel);
        var next = idx < 0 ? (dir > 0 ? 0 : list.Count - 1) : (idx + dir + list.Count) % list.Count;
        PlayChannel(list[next]);
    }

    private static int IndexOf(IReadOnlyList<Channel> list, Channel ch)
    {
        for (var i = 0; i < list.Count; i++) if (list[i] == ch) return i;
        return -1;
    }

    /// <summary>Torna al canale visto prima; da un film o episodio torna alla TV.</summary>
    [RelayCommand]
    private void LastChannel()
    {
        if (IsVod && CurrentChannel != null) PlayChannel(CurrentChannel);
        else if (_previous != null) PlayChannel(_previous);
    }

    [RelayCommand]
    private void TogglePlay()
    {
        if (IsVod)
        {
            if (Player.IsActive) Player.TogglePause();
            else ReplayCurrentVod();
            return;
        }
        if (Player.IsActive)
        {
            Player.Stop();
            return;
        }
        if (CurrentChannel is { } ch && _client != null)
        {
            PlayLive(ch);
            MediaStarted?.Invoke(ch);
        }
    }

    [RelayCommand]
    private void Reload()
    {
        if (Player.IsActive) Player.Reload();
        else TogglePlay();
    }

    [RelayCommand]
    private void ToggleMute() => IsMuted = !IsMuted;

    public void ChangeVolume(int delta)
    {
        Volume = Math.Clamp(Volume + delta, 0, 125);
        if (IsMuted && delta > 0) IsMuted = false;
    }

    partial void OnVolumeChanged(int value)
    {
        Player.Volume = value;
        _settings.Volume = value;
        ScheduleSave();
    }

    partial void OnIsMutedChanged(bool value)
    {
        Player.Muted = value;
        _settings.Muted = value;
        ScheduleSave();
    }

    private void OnPlaybackChanged()
    {
        var s = Player.State;
        if (s != PlaybackState.Idle) PlaybackError = null;
        IsIdle = s == PlaybackState.Idle;
        IsPlaying = s != PlaybackState.Idle;
        IsPaused = s == PlaybackState.Paused;
        IsPlaybackBusy = s is PlaybackState.Connecting or PlaybackState.Buffering or PlaybackState.Reconnecting;
        // Copre l'ultimo fotogramma del canale precedente finché il nuovo non parte davvero.
        // A riposo copre anche l'ultimo fotogramma di un film o episodio finito.
        IsVideoCovered = s is PlaybackState.Connecting or PlaybackState.Idle || (s == PlaybackState.Reconnecting && Player.Attempt >= 2);
        ShowIdlePlaceholder = IsIdle && NextEpisodeOffer == null;
        UpdatePlayGlyph();
        PlaybackMessage = s switch
        {
            PlaybackState.Connecting => Player.BufferPercent > 0 ? $"Caricamento {Player.BufferPercent:0}%" : "Connessione…",
            PlaybackState.Buffering => $"Buffering {Player.BufferPercent:0}%",
            PlaybackState.Reconnecting => Player.Attempt > 3 ? $"Il contenuto non risponde · tentativo {Player.Attempt}" : "Riconnessione in corso…",
            _ => null,
        };
    }

    private void UpdatePlayGlyph()
    {
        var s = Player.State;
        PlayPauseGlyph = IsVod
            ? (s is PlaybackState.Paused or PlaybackState.Idle ? "" : "")
            : (s == PlaybackState.Idle ? "" : "");
    }

    // ---------- Selezione per numero ----------

    public void AppendDigit(int digit)
    {
        if (_numberBuffer.Length >= 4) _numberBuffer = "";
        _numberBuffer += digit.ToString();
        NumberEntry = _numberBuffer;
        _numberTimer.Stop();
        _numberTimer.Start();
    }

    public void CommitNumber()
    {
        _numberTimer.Stop();
        if (_numberBuffer.Length == 0) return;
        var n = int.Parse(_numberBuffer);
        _numberBuffer = "";
        NumberEntry = null;
        var ch = _all.FirstOrDefault(c => c.Num == n);
        if (ch != null) PlayChannel(ch);
        else ShowToast($"Nessun canale con numero {n}");
    }

    // ---------- Guida TV ----------

    private async Task LoadEpgAsync(bool force)
    {
        if (_client == null) return;
        var ids = _all.Where(c => c.EpgId != null).Select(c => c.EpgId!).Distinct().ToList();
        await _epg.LoadAsync(_client, ids, force, CancellationToken.None);
        UpdateAllEpg();
    }

    private async Task EnsureShortEpgAsync(Channel ch)
    {
        if (_client == null) return;
        if (await _epg.EnsureShortAsync(_client, ch, CancellationToken.None))
        {
            UpdateChannelEpg(ch, DateTimeOffset.Now);
            if (ch == CurrentChannel) UpdateCurrentEpg();
        }
    }

    private void UpdateAllEpg()
    {
        var now = DateTimeOffset.Now;
        foreach (var ch in _all) UpdateChannelEpg(ch, now);
        UpdateCurrentEpg();
    }

    private void UpdateChannelEpg(Channel ch, DateTimeOffset now)
    {
        var (cur, _) = _epg.GetNowNext(ch, now);
        ch.NowTitle = cur?.Title;
        ch.NowProgress = cur?.ProgressAt(now) ?? 0;
    }

    private void UpdateCurrentEpg()
    {
        if (CurrentChannel is not { } ch) { CurrentNow = CurrentNext = null; return; }
        var now = DateTimeOffset.Now;
        var (cur, next) = _epg.GetNowNext(ch, now);
        CurrentNow = cur;
        CurrentNext = next;
        CurrentProgress = cur?.ProgressAt(now) ?? 0;
        if (!IsVod) NowPlayingSubtitle = cur?.Title;
    }

    // ---------- Impostazioni ----------

    [RelayCommand]
    private void ToggleSettings() => IsSettingsOpen = !IsSettingsOpen;

    /// <summary>Nasconde le categorie con "XXX" nel nome, con tutto il loro contenuto (anche da Tutti e dalla ricerca).</summary>
    public bool HideAdult
    {
        get => _settings.HideAdult;
        set
        {
            if (_settings.HideAdult == value) return;
            _settings.HideAdult = value;
            OnPropertyChanged();
            ScheduleSave();
            ReapplyHidden();
            // Col server di casa vale per il profilo in uso.
            QueueServerOp(new JsonObject { ["op"] = "hideAdult", ["on"] = value }, now: true);
        }
    }

    /// <summary>Stile grafico (moderno, skeuomorfico, Modern UI, Dueffe o Nothing): si salva e il programma si riapre con il nuovo stile.</summary>
    public bool IsClassicSkin { get => _settings.Skin is not ("skeuo" or "metro" or "dueffe" or "nothing"); set { if (value) SetSkin("classic"); } }
    public bool IsSkeuo { get => _settings.Skin == "skeuo"; set { if (value) SetSkin("skeuo"); } }
    public bool IsMetro { get => _settings.Skin == "metro"; set { if (value) SetSkin("metro"); } }
    public bool IsDueffe { get => _settings.Skin == "dueffe"; set { if (value) SetSkin("dueffe"); } }
    public bool IsNothing { get => _settings.Skin == "nothing"; set { if (value) SetSkin("nothing"); } }

    private void SetSkin(string skin)
    {
        if (_settings.Skin == skin) return;
        _settings.Skin = skin;
        OnPropertyChanged(nameof(IsClassicSkin));
        OnPropertyChanged(nameof(IsSkeuo));
        OnPropertyChanged(nameof(IsMetro));
        OnPropertyChanged(nameof(IsDueffe));
        OnPropertyChanged(nameof(IsNothing));
        SaveNow();
        App.Restart();
    }

    private static bool IsHiddenCategory(Category c) => c.Name.Contains("xxx", StringComparison.OrdinalIgnoreCase);

    private (List<Category>, List<T>) WithoutHidden<T>(List<Category> cats, List<T> items, Func<T, string?> categoryOf)
    {
        if (!_settings.HideAdult) return (cats, items);
        var hidden = cats.Where(IsHiddenCategory).Select(c => c.Id).ToHashSet();
        if (hidden.Count == 0) return (cats, items);
        return (cats.Where(c => !hidden.Contains(c.Id)).ToList(),
            items.Where(i => categoryOf(i) is not { } id || !hidden.Contains(id)).ToList());
    }

    private void ReapplyHidden()
    {
        if (_rawLive is { } l) Populate(l.Cats, l.Items);
        if (_rawMovies is { } m) PopulateMovies(m.Cats, m.Items);
        if (_rawSeries is { } s) PopulateSeries(s.Cats, s.Items);
        RebuildCategories();
        ApplyFilter();
        if (!string.IsNullOrWhiteSpace(SearchText)) RunSearch();
        RefreshTvItems();
    }

    public bool UseHls
    {
        get => _settings.OutputFormat == "m3u8";
        set
        {
            var f = value ? "m3u8" : "ts";
            if (_settings.OutputFormat == f) return;
            _settings.OutputFormat = f;
            OnPropertyChanged();
            ScheduleSave();
            RestartCurrent();
        }
    }

    public int NetworkCachingMs
    {
        get => _settings.NetworkCachingMs;
        set
        {
            if (_settings.NetworkCachingMs == value) return;
            _settings.NetworkCachingMs = value;
            Player.NetworkCachingMs = value;
            OnPropertyChanged();
            ScheduleSave();
            RestartCurrent();
        }
    }

    public bool HardwareDecoding
    {
        get => _settings.HardwareDecoding;
        set
        {
            if (_settings.HardwareDecoding == value) return;
            _settings.HardwareDecoding = value;
            Player.Player.EnableHardwareDecoding = value;
            OnPropertyChanged();
            ScheduleSave();
            RestartCurrent();
        }
    }

    public bool Deinterlace
    {
        get => _settings.Deinterlace;
        set
        {
            if (_settings.Deinterlace == value) return;
            _settings.Deinterlace = value;
            OnPropertyChanged();
            ScheduleSave();
            ShowToast("Il deinterlacciamento cambia al prossimo avvio");
        }
    }

    public bool AutoPlayLastChannel
    {
        get => _settings.AutoPlayLastChannel;
        set
        {
            _settings.AutoPlayLastChannel = value;
            OnPropertyChanged();
            ScheduleSave();
        }
    }

    /// <summary>Speedtest del canale che sta partendo: un altro avvio lo rende inutile.</summary>
    private int _speedRun;

    private async void PlayLive(Channel ch)
    {
        var client = _client!;
        int[] ids = [ch.StreamId, .. ch.Alternates];
        void Start(int i) => Player.Play(client.GetLiveUrl(ids[i], _settings.OutputFormat),
            alternates: ids.Where((_, j) => j != i).Select(id => client.GetLiveUrl(id, _settings.OutputFormat)).ToList());
        var run = ++_speedRun;
        if (!_settings.LiveSpeedTest || ids.Length < 2) { Start(0); return; }
        ShowToast("Misuro la velocità…");
        var token = _settings.HomeServer == null ? null : SettingsService.Unprotect(_settings.ProtectedPassword);
        var mbps = await SpeedTest.LiveAsync(_settings.HomeServer, token);
        if (run != _speedRun || CurrentChannel != ch || IsVod) return;
        var pick = mbps is { } m ? TextHelpers.PickBySpeed(ch.Ranks, m) : 0;
        if (mbps is { } shown) ShowToast($"{Math.Round(shown)} Mb/s · {TextHelpers.QualityLabels[ch.Ranks[pick]]}");
        Start(pick);
    }

    public bool LiveSpeedTest
    {
        get => _settings.LiveSpeedTest;
        set
        {
            if (_settings.LiveSpeedTest == value) return;
            _settings.LiveSpeedTest = value;
            OnPropertyChanged();
            ScheduleSave();
        }
    }

    private void RestartCurrent()
    {
        if (!Player.IsActive) return;
        if (IsVod) Player.Reload();
        else if (CurrentChannel is { } ch && _client != null)
            PlayLive(ch);
    }

    [RelayCommand]
    private void ClearCache()
    {
        CacheService.Clear();
        ShowToast("Cache svuotata");
        _ = RefreshAsync(userInitiated: true);
    }

    // ---------- Varie ----------

    public void ShowToast(string message)
    {
        Toast = message;
        _toastTimer.Stop();
        _toastTimer.Start();
    }

    public void ScheduleSave()
    {
        _saveTimer.Stop();
        _saveTimer.Start();
    }

    public void SaveNow()
    {
        _saveTimer.Stop();
        SettingsService.Save(_settings);
    }

    public void Dispose()
    {
        _epgTimer.Stop();
        _refreshCts?.Cancel();
        SaveCurrentPosition();
        _positions.Save(force: true);
        SaveNow();
        Player.Dispose();
    }
}
