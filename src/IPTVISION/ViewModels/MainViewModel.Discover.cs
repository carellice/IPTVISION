using System.Windows.Media;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Un titolo del catalogo nella schermata "Film e serie", con la sua scheda TMDB se trovata.</summary>
public sealed partial class DiscoverTile : ObservableObject
{
    public DiscoverTile(ArtworkItem item, IReadOnlyList<ArtworkItem> variants, Tmdb.Card? card)
    {
        Item = item;
        Variants = variants;
        Card = card;
    }

    public ArtworkItem Item { get; }
    public IReadOnlyList<ArtworkItem> Variants { get; }
    public bool IsSeries => Item is Series;
    public string Key => Item is Movie m ? m.Key : ((Series)Item).Key;
    public string Name => Item.ItemName;
    public string Initials => Item is Movie m ? m.Initials : ((Series)Item).Initials;
    public string? Year => Item is Movie m ? m.Data.Year : ((Series)Item).Data.Year;
    public Tmdb.Kind Kind => IsSeries ? Tmdb.Kind.Tv : Tmdb.Kind.Movie;

    /// <summary>Numero della classifica (Top 10), 0 altrove.</summary>
    public int Rank { get; init; }
    /// <summary>Riga sotto il titolo nei riquadri larghi di "Continua a guardare".</summary>
    public string? Subtitle { get; init; }
    public double Progress => Item.Progress;
    public bool HasProgress => Item.HasProgress;
    public bool ShowSeriesBadge { get; init; }
    public bool ShowCaption { get; init; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DisplayTitle))]
    private Tmdb.Card? _card;

    public string DisplayTitle => Card?.Title is { Length: > 0 } t ? t : Name;

    /// <summary>Se la scheda TMDB manca, la si chiede (solo dove serve: continua a guardare, la mia lista).</summary>
    public bool NeedsLookup { get; init; }

    private ImageSource? _poster;
    private bool _posterAsked;

    public ImageSource? Poster
    {
        get
        {
            if (!_posterAsked)
            {
                _posterAsked = true;
                RequestArt();
            }
            return _poster;
        }
        private set { if (SetProperty(ref _poster, value)) OnPropertyChanged(nameof(HasPoster)); }
    }

    public bool HasPoster => _poster != null;

    private ImageSource? _scene;
    private bool _sceneAsked;

    /// <summary>La scena del titolo (riquadri larghi).</summary>
    public ImageSource? Scene
    {
        get
        {
            if (!_sceneAsked)
            {
                _sceneAsked = true;
                RequestArt();
            }
            return _scene;
        }
        private set { if (SetProperty(ref _scene, value)) OnPropertyChanged(nameof(HasScene)); }
    }

    public bool HasScene => _scene != null;

    private bool _looked;

    private async void RequestArt()
    {
        if (Card == null && NeedsLookup && !_looked && MainViewModel.TmdbKeyNow is { Length: > 0 } key)
        {
            _looked = true;
            Card = await Tmdb.Lookup(key, Kind, Name, Year);
        }
        if (_posterAsked) LogoService.Instance.Request(Tmdb.Img(Card?.Poster) ?? (Item is Movie m ? m.Data.Poster : ((Series)Item).Data.Cover), img => Poster = img, 240);
        if (_sceneAsked) LogoService.Instance.Request(Tmdb.Img(Card?.Backdrop, "w780") ?? (Item is Movie mm ? mm.Data.Poster : ((Series)Item).Data.Cover), img => Scene = img, 480);
    }
}

/// <summary>Una riga della schermata: titolo e riquadri che scorrono di lato.</summary>
public sealed class DiscoverRow(string title, IReadOnlyList<DiscoverTile> tiles)
{
    public string Title { get; } = title;
    public IReadOnlyList<DiscoverTile> Tiles { get; } = tiles;
    public bool IsTop { get; init; }
    public bool IsWide { get; init; }
    public bool IsPoster => !IsTop && !IsWide;
    /// <summary>"Vedi tutto": la categoria da aprire nel pannello (null = niente link).</summary>
    public (LibraryMode Mode, string Id)? All { get; init; }
    public bool HasAll => All != null;
}

/// <summary>Il titolo "Le categorie della lista" tra le righe.</summary>
public sealed class DiscoverHeading(string text) { public string Text { get; } = text; }

/// <summary>Un pallino sotto l'immagine grande: uno per titolo, acceso quello mostrato.</summary>
public sealed record HeroDot(int Index, bool IsCurrent);

/// <summary>In alto: i filtri e il titolo di tendenza che cambia da solo.</summary>
public sealed partial class DiscoverHero : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Tile), nameof(Kicker), nameof(Meta), nameof(Overview), nameof(PlayText), nameof(HasTile))]
    private int _index;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Tile), nameof(Kicker), nameof(Meta), nameof(Overview), nameof(PlayText), nameof(HasTile))]
    private IReadOnlyList<DiscoverTile> _items = [];

    [ObservableProperty] private ImageSource? _picture;
    [ObservableProperty] private bool _inMyList;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private bool _isLoading = true;

    public DiscoverTile? Tile => Items.Count == 0 ? null : Items[Index % Items.Count];
    public bool HasTile => Tile != null;
    public string Kicker => $"N. {Index + 1} DI TENDENZA";
    public string? Meta => Tile?.Card is { } c
        ? TextHelpers.JoinMeta(Tile.IsSeries ? "Serie TV" : "Film", c.Year, c.Vote > 0 ? $"★ {c.Vote.ToString("0.0", System.Globalization.CultureInfo.GetCultureInfo("it-IT"))}" : null)
        : null;
    public string? Overview => Tile?.Card?.Overview is { Length: > 0 } o ? o : null;
    public string PlayText => Tile?.IsSeries == true ? "Episodi" : "Riproduci";
    public IReadOnlyList<HeroDot> Dots => Enumerable.Range(0, Items.Count).Select(n => new HeroDot(n, n == Index)).ToList();

    partial void OnItemsChanged(IReadOnlyList<DiscoverTile> value) => OnPropertyChanged(nameof(Dots));
    partial void OnIndexChanged(int value) => OnPropertyChanged(nameof(Dots));
}

public sealed partial class MainViewModel
{
    private DispatcherTimer? _heroTimer;
    private List<Tmdb.Row>? _tmdbRows;
    private Task? _tmdbTask;
    private string _discoverFilter = "all";

    /// <summary>La chiave TMDB in uso (per i riquadri che chiedono la propria scheda).</summary>
    internal static string? TmdbKeyNow { get; private set; }

    public bool HasTmdb => !string.IsNullOrEmpty(_settings.TmdbKey);
    /// <summary>Con la chiave TMDB le schede Film e Serie diventano una sola, "Film e serie".</summary>
    public int ModeTabColumns => HasTmdb ? 2 : 3;

    /// <summary>La schermata "Film e serie" copre tutta la finestra (il video è una finestra nativa: sotto non si vede).</summary>
    [ObservableProperty] private bool _showDiscover;
    [ObservableProperty] private IReadOnlyList<object> _discoverItems = [];
    [ObservableProperty] private bool _isDiscoverCategoriesOpen;
    public DiscoverHero Hero { get; } = new();

    public bool IsDiscoverAll => _discoverFilter == "all";
    public bool IsDiscoverMovies => _discoverFilter == "movie";
    public bool IsDiscoverSeries => _discoverFilter == "tv";

    /// <summary>La scheda "Film e serie" del pannello: accesa fuori dalla TV in diretta.</summary>
    public bool IsDiscoverMode
    {
        get => Mode != LibraryMode.Live;
        set { if (value) OpenDiscover(); }
    }

    public IReadOnlyList<Category> DiscoverMovieCategories => [new Category(CategoryItem.AllId, "Tutti i film"), .. _vodCats];
    public IReadOnlyList<Category> DiscoverSeriesCategories => [new Category(CategoryItem.AllId, "Tutte le serie"), .. _seriesCats];

    partial void OnShowDiscoverChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowVideo));
        NotifyVariantChooser();
        if (value) _heroTimer?.Start(); else _heroTimer?.Stop();
    }

    public string TmdbKeyInput { get; set; } = "";
    [ObservableProperty] private string? _tmdbKeyError;
    [ObservableProperty] private bool _isTmdbChecking;

    [RelayCommand]
    private async Task SaveTmdbKey(string? key)
    {
        key = (key ?? TmdbKeyInput).Trim();
        if (key.Length == 0 || IsTmdbChecking) return;
        IsTmdbChecking = true;
        TmdbKeyError = null;
        try
        {
            await Tmdb.Check(key);
            SetTmdbKey(key);
            ShowToast("Chiave TMDB salvata: trovi tutto in \"Film e serie\"");
        }
        catch (Exception ex) { TmdbKeyError = ex.Message; }
        finally { IsTmdbChecking = false; }
    }

    [RelayCommand]
    private void RemoveTmdbKey() => SetTmdbKey("");

    /// <summary>Con il server di casa la chiave è dell'account: la ricevono tutti i dispositivi collegati.</summary>
    private void SetTmdbKey(string key)
    {
        ApplyTmdbKey(key);
        QueueServerOp(new System.Text.Json.Nodes.JsonObject { ["op"] = "tmdbKey", ["key"] = _settings.TmdbKey ?? "" }, now: true);
    }

    private void ApplyTmdbKey(string key)
    {
        _settings.TmdbKey = key.Length == 0 ? null : key;
        TmdbKeyNow = _settings.TmdbKey;
        ScheduleSave();
        Tmdb.ClearCache();
        _tmdbRows = null;
        _tmdbTask = null;
        Hero.Items = [];
        DiscoverItems = [];
        ShowDiscover = false;
        OnPropertyChanged(nameof(HasTmdb));
        OnPropertyChanged(nameof(ModeTabColumns));
    }

    private void InitDiscover()
    {
        TmdbKeyNow = _settings.TmdbKey;
        _heroTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(9) };
        _heroTimer.Tick += (_, _) => { if (Hero.Items.Count > 1) SetHero((Hero.Index + 1) % Hero.Items.Count); };
    }

    [RelayCommand]
    public void OpenDiscover()
    {
        if (!HasTmdb) { Mode = LibraryMode.Movies; return; }
        if (Mode == LibraryMode.Live) Mode = LibraryMode.Movies;
        IsSettingsOpen = false;
        ShowDiscover = true;
        OnPropertyChanged(nameof(IsDiscoverMode));
        _ = LoadDiscoverAsync();
    }

    [RelayCommand]
    private void CloseDiscover() => ShowDiscover = false;

    /// <summary>"TV" dalla schermata "Film e serie": si torna ai canali.</summary>
    [RelayCommand]
    private void DiscoverToLive()
    {
        ShowDiscover = false;
        Mode = LibraryMode.Live;
    }

    [RelayCommand]
    private void SetDiscoverFilter(string? f)
    {
        _discoverFilter = f ?? "all";
        OnPropertyChanged(nameof(IsDiscoverAll));
        OnPropertyChanged(nameof(IsDiscoverMovies));
        OnPropertyChanged(nameof(IsDiscoverSeries));
        BuildDiscover();
    }

    private async Task LoadDiscoverAsync()
    {
        var key = _settings.TmdbKey;
        if (key == null) return;
        await Task.WhenAll(EnsureMoviesAsync(), EnsureSeriesAsync());
        BuildDiscover();
        if (_tmdbRows != null) return;
        Hero.Error = null;
        Hero.IsLoading = true;
        _tmdbTask ??= Task.Run(async () =>
        {
            try { await Tmdb.Check(key); }
            catch (Exception ex) { await App.Current.Dispatcher.InvokeAsync(() => Hero.Error = $"{ex.Message} Controlla la chiave nelle impostazioni, alla voce TMDB."); }
            var rows = await Tmdb.LoadRows(key);
            await App.Current.Dispatcher.InvokeAsync(() =>
            {
                if (_settings.TmdbKey != key) return;
                _tmdbRows = rows;
                Hero.IsLoading = false;
                BuildDiscover();
            });
        });
        await _tmdbTask;
    }

    /// <summary>Le liste di TMDB diventano righe di titoli del catalogo, più le righe del catalogo stesso.</summary>
    private void BuildDiscover()
    {
        bool Pass(ArtworkItem i) => _discoverFilter == "all" || (_discoverFilter == "tv") == i is Series;

        // Il catalogo ritrovabile per titolo, ogni titolo con tutte le sue versioni.
        Dictionary<string, List<ArtworkItem>> ByKey(IEnumerable<ArtworkItem> items)
        {
            var d = new Dictionary<string, List<ArtworkItem>>();
            foreach (var i in items)
            {
                var k = Tmdb.MatchKey(i.ItemName);
                if (k.Length == 0) continue;
                if (d.TryGetValue(k, out var l)) l.Add(i); else d[k] = [i];
            }
            return d;
        }
        var movies = ByKey(_movies);
        var series = ByKey(_series);
        List<ArtworkItem> VariantsOf(ArtworkItem i) => (i is Movie ? movies : series).GetValueOrDefault(Tmdb.MatchKey(i.ItemName)) ?? [i];
        string? YearOf(ArtworkItem i) => i is Movie m ? m.Data.Year : ((Series)i).Data.Year;

        var known = new Dictionary<string, Tmdb.Card>();
        var rows = new List<(Tmdb.Row Row, List<DiscoverTile> Tiles)>();
        foreach (var r in _tmdbRows ?? [])
        {
            var seen = new HashSet<string>();
            var tiles = new List<DiscoverTile>();
            foreach (var c in r.Items)
            {
                var map = c.Kind == Tmdb.Kind.Movie ? movies : series;
                var hit = c.Keys.Select(k => map.GetValueOrDefault(k)).OfType<List<ArtworkItem>>().FirstOrDefault(l => Tmdb.YearsClose(YearOf(l[0]), c.Year));
                if (hit == null || !Pass(hit[0])) continue;
                var tile = new DiscoverTile(hit[0], hit, c) { Rank = r.Top ? tiles.Count + 1 : 0, ShowSeriesBadge = hit[0] is Series };
                if (!seen.Add(tile.Key)) continue;
                known[tile.Key] = c;
                tiles.Add(tile);
                if (tiles.Count >= (r.Top ? 10 : 40)) break;
            }
            rows.Add((r, tiles));
        }

        var items = new List<object> { Hero };
        DiscoverTile Tile(ArtworkItem i, bool caption = false, string? subtitle = null) =>
            new(i, VariantsOf(i), known.GetValueOrDefault(i is Movie m ? m.Key : ((Series)i).Key))
            { NeedsLookup = !caption, ShowSeriesBadge = i is Series && !caption, ShowCaption = caption, Subtitle = subtitle };

        // Continua a guardare: dal più recente, film e serie insieme.
        var cont = _movies.Where(m => _positions.GetResumeMs(m.Key) > 0).Select(m => (Item: (ArtworkItem)m, U: _positions.GetUpdatedAt(m.Key) ?? default))
            .Concat(_series.Select(s => (Item: (ArtworkItem)s, U: _positions.GetLastEpisode(s.SeriesId)?.UpdatedAt ?? default)).Where(x => x.U != default))
            .Where(x => Pass(x.Item)).OrderByDescending(x => x.U)
            .DistinctBy(x => Tmdb.MatchKey(x.Item.ItemName) + (x.Item is Series ? "|s" : "|m"))
            .Select(x => Tile(x.Item, subtitle: x.Item is Movie ? "Film" : "Serie TV · riprendi l'episodio")).ToList();
        if (cont.Count > 0) items.Add(new DiscoverRow("Continua a guardare", cont) { IsWide = true });

        var mine = _movies.Cast<ArtworkItem>().Concat(_series).Where(i => _positions.InMyList(i is Movie m ? m.Key : ((Series)i).Key) && Pass(i))
            .OrderByDescending(i => _positions.MyListAddedAt(i is Movie m ? m.Key : ((Series)i).Key))
            .Select(i => Tile(i)).ToList();
        if (mine.Count > 0) items.Add(new DiscoverRow("La mia lista", mine));

        var shown = rows.Where(x => x.Tiles.Count >= (x.Row.Top ? 5 : 4)).ToList();
        for (var i = 0; i < shown.Count; i++)
        {
            var (r, tiles) = shown[i];
            items.Add(new DiscoverRow(r.Top ? r.Title + " in Italia" : r.Title, tiles) { IsTop = r.Top });
            if (i == 1 && _discoverFilter != "tv")
            {
                var recent = _movies.OrderByDescending(m => m.Data.Added).DistinctBy(m => TextHelpers.VariantKey(m.Name)).Take(30).Select(m => Tile(m)).ToList();
                if (recent.Count > 0) items.Add(new DiscoverRow("Aggiunti di recente", recent) { All = (LibraryMode.Movies, CategoryItem.AllId) });
            }
        }
        if (_tmdbRows != null && shown.Count == 0 && Hero.Error == null)
            items.Add(new DiscoverHeading("Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista."));

        items.Add(new DiscoverHeading("Le categorie della lista"));
        if (_discoverFilter != "tv")
            foreach (var c in _vodCats)
            {
                var list = _movies.Where(m => m.CategoryId == c.Id).DistinctBy(m => TextHelpers.VariantKey(m.Name)).Take(30).Select(m => Tile(m, caption: true)).ToList();
                if (list.Count > 0) items.Add(new DiscoverRow(c.Name, list) { All = (LibraryMode.Movies, c.Id) });
            }
        if (_discoverFilter != "movie")
            foreach (var c in _seriesCats)
            {
                var list = _series.Where(s => s.CategoryId == c.Id).DistinctBy(s => TextHelpers.VariantKey(s.Name)).Take(30).Select(s => Tile(s, caption: true)).ToList();
                if (list.Count > 0) items.Add(new DiscoverRow(c.Name + " · Serie", list) { All = (LibraryMode.Series, c.Id) });
            }

        Hero.Items = (shown.FirstOrDefault(x => x.Row.Id == "trend").Tiles ?? []).Where(t => t.Card?.Backdrop != null).Take(6).ToList();
        SetHero(0);
        DiscoverItems = items;
        OnPropertyChanged(nameof(DiscoverMovieCategories));
        OnPropertyChanged(nameof(DiscoverSeriesCategories));
    }

    [RelayCommand]
    private void SetHero(int i)
    {
        Hero.Index = i;
        var t = Hero.Tile;
        Hero.InMyList = t != null && InMyList(t.Item);
        Hero.Picture = null;
        if (t?.Card?.Backdrop is { } b) LogoService.Instance.Request(Tmdb.Img(b, "w1280"), img => { if (Hero.Tile == t) Hero.Picture = img; }, 1280);
        _heroTimer?.Stop();
        if (ShowDiscover) _heroTimer?.Start();
    }

    /// <summary>Apre il titolo: i film partono (o si sceglie la versione), le serie mostrano gli episodi nel pannello.</summary>
    [RelayCommand]
    private void OpenDiscoverTile(DiscoverTile? t)
    {
        if (t == null) return;
        t.Item.Variants = t.Variants.Count > 1 ? t.Variants : [];
        if (t.Item is Movie m)
        {
            if (!m.HasVariants) ShowDiscover = false;
            OpenMovie(m);
        }
        else if (t.Item is Series s)
        {
            ShowDiscover = false;
            if (Mode != LibraryMode.Series) Mode = LibraryMode.Series;
            OpenSeriesItem(s);
        }
    }

    [RelayCommand]
    private void PlayHero() => OpenDiscoverTile(Hero.Tile);

    [RelayCommand]
    private void ToggleHeroMyList()
    {
        if (Hero.Tile is not { } t) return;
        ToggleMyList(t.Item);
        Hero.InMyList = InMyList(t.Item);
    }

    [RelayCommand]
    private void DiscoverSeeAll(DiscoverRow? r)
    {
        if (r?.All is not { } a) return;
        OpenDiscoverCategory(a.Mode, a.Id);
    }

    [RelayCommand]
    private void OpenDiscoverMovieCategory(string? id) => OpenDiscoverCategory(LibraryMode.Movies, id ?? CategoryItem.AllId);

    [RelayCommand]
    private void OpenDiscoverSeriesCategory(string? id) => OpenDiscoverCategory(LibraryMode.Series, id ?? CategoryItem.AllId);

    /// <summary>Tutti i titoli di una categoria: nel pannello, con ordinamento ed elenco o griglia.</summary>
    private void OpenDiscoverCategory(LibraryMode mode, string id)
    {
        IsDiscoverCategoriesOpen = false;
        ShowDiscover = false;
        OpenCategoryHit(new CategoryHit(mode, id, "", 0));
    }
}
