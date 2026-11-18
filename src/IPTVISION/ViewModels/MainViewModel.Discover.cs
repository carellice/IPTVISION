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

/// <summary>Una categoria della lista nella griglia in fondo: nome e quanti titoli; si apre con tutti i suoi titoli.</summary>
public sealed record DiscoverCat(string Name, int Count, LibraryMode Mode, string Id)
{
    public string Icon => Mode == LibraryMode.Series ? "" : "";
}

/// <summary>Le categorie della lista a griglia, al posto delle righe che scorrono di lato.</summary>
public sealed class DiscoverCatGrid(IReadOnlyList<DiscoverCat> cats) { public IReadOnlyList<DiscoverCat> Cats { get; } = cats; }

/// <summary>Il titolo "Le categorie della lista" tra le righe.</summary>
public sealed class DiscoverHeading(string text) { public string Text { get; } = text; }

/// <summary>In alto: l'errore di TMDB e lo stato di caricamento delle tendenze.</summary>
public sealed partial class DiscoverHero : ObservableObject
{
    [ObservableProperty] private string? _error;
    [ObservableProperty] private bool _isLoading = true;
}

public sealed partial class MainViewModel
{
    private List<Tmdb.Row>? _tmdbRows;
    private Task? _tmdbTask;
    private string _discoverFilter = "all";

    /// <summary>La chiave TMDB in uso (per i riquadri che chiedono la propria scheda).</summary>
    internal static string? TmdbKeyNow { get; private set; }

    /// <summary>La chiave integrata nella build (da tmdb.key), usata quando non se ne mette una a mano.</summary>
    private static readonly string BuiltinTmdb = System.Reflection.Assembly.GetExecutingAssembly()
        .GetCustomAttributes(typeof(System.Reflection.AssemblyMetadataAttribute), false).OfType<System.Reflection.AssemblyMetadataAttribute>()
        .FirstOrDefault(a => a.Key == "TmdbKey")?.Value ?? "";

    /// <summary>La chiave messa a mano, altrimenti quella integrata.</summary>
    private string? TmdbKey => _settings.TmdbKey ?? (BuiltinTmdb.Length > 0 ? BuiltinTmdb : null);
    public bool HasTmdb => !string.IsNullOrEmpty(TmdbKey);
    public bool HasOwnTmdb => !string.IsNullOrEmpty(_settings.TmdbKey);
    /// <summary>Con la chiave TMDB le schede Film e Serie diventano due: "Film e serie" e "La mia lista".</summary>
    public int ModeTabColumns => HasTmdb ? 3 : 3;

    /// <summary>Cosa si sta caricando, in alto a destra in "Film e serie" (null: niente).</summary>
    [ObservableProperty] private string? _discoverBusy;

    /// <summary>"La mia lista" aperta: la schermata mostra solo i titoli aggiunti con +.</summary>
    private bool _myListOpen;
    /// <summary>Le righe vanno rifatte (catalogo, TMDB, filtro o posizioni cambiati); se no si riapre la pagina dov'era.</summary>
    private bool _discoverStale = true;

    public bool IsMyListMode
    {
        get => Mode != LibraryMode.Live && _myListOpen;
        set { if (value) OpenMyList(); }
    }

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
        get => Mode != LibraryMode.Live && !_myListOpen;
        set { if (value) OpenDiscover(); }
    }

    public IReadOnlyList<Category> DiscoverMovieCategories => [new Category(CategoryItem.AllId, "Tutti i film"), .. _vodCats];
    public IReadOnlyList<Category> DiscoverSeriesCategories => [new Category(CategoryItem.AllId, "Tutte le serie"), .. _seriesCats];

    partial void OnShowDiscoverChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowVideo));
        NotifyVariantChooser();
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
        // Al server va solo la chiave messa a mano: quella integrata resta nell'app.
        ApplyTmdbKey(key);
        QueueServerOp(new System.Text.Json.Nodes.JsonObject { ["op"] = "tmdbKey", ["key"] = _settings.TmdbKey ?? "" }, now: true);
    }

    private void ApplyTmdbKey(string key)
    {
        _settings.TmdbKey = key.Length == 0 ? null : key;
        TmdbKeyNow = TmdbKey;
        _discoverStale = true;
        ScheduleSave();
        Tmdb.ClearCache();
        _tmdbRows = null;
        _tmdbTask = null;
        DiscoverItems = [];
        ShowDiscover = false;
        OnPropertyChanged(nameof(HasTmdb));
        OnPropertyChanged(nameof(HasOwnTmdb));
        OnPropertyChanged(nameof(ModeTabColumns));
    }

    private void InitDiscover()
    {
        TmdbKeyNow = TmdbKey;
    }

    [RelayCommand]
    public void OpenDiscover() => ShowDiscoverPage(myList: false);

    [RelayCommand]
    public void OpenMyList() => ShowDiscoverPage(myList: true);

    private void ShowDiscoverPage(bool myList)
    {
        if (!HasTmdb) { Mode = LibraryMode.Movies; return; }
        if (_myListOpen != myList) { _myListOpen = myList; _discoverStale = true; }
        if (Mode == LibraryMode.Live) Mode = LibraryMode.Movies;
        IsSettingsOpen = false;
        ShowDiscover = true;
        OnPropertyChanged(nameof(IsDiscoverMode));
        OnPropertyChanged(nameof(IsMyListMode));
        _ = LoadDiscoverAsync();
    }

    /// <summary>Catalogo, TMDB o posizioni cambiati: la pagina si rifà alla prossima apertura (o subito, se è aperta).</summary>
    private void DiscoverChanged()
    {
        _discoverStale = true;
        if (ShowDiscover) BuildDiscover();
    }

    /// <summary>Il testo del riquadro in alto a destra: cosa si sta caricando.</summary>
    private void UpdateDiscoverBusy() => DiscoverBusy =
        IsLibraryLoading && _movies.Count == 0 ? "Carico i film…"
        : _series.Count == 0 && _seriesTask is { IsCompleted: false } ? "Carico le serie…"
        : IsRefreshing ? "Cerco titoli nuovi…"
        : Hero.IsLoading ? "Preparo le tendenze…" : null;

    [RelayCommand]
    private void CloseDiscover() => ShowDiscover = false;

    [RelayCommand]
    private void SetDiscoverFilter(string? f)
    {
        _discoverFilter = f ?? "all";
        _discoverStale = true;
        OnPropertyChanged(nameof(IsDiscoverAll));
        OnPropertyChanged(nameof(IsDiscoverMovies));
        OnPropertyChanged(nameof(IsDiscoverSeries));
        BuildDiscover();
    }

    private async Task LoadDiscoverAsync()
    {
        var key = TmdbKey;
        if (key == null) return;
        // La pagina si mostra appena c'è uno dei due cataloghi: l'altro (e TMDB) arriva dopo, senza bloccarla.
        // Già fatta e niente di cambiato: resta com'era, allo stesso punto (anche tornando da "Guarda tutto").
        var movies = EnsureMoviesAsync();
        var series = EnsureSeriesAsync();
        UpdateDiscoverBusy();
        if (_discoverStale || DiscoverItems.Count == 0) BuildDiscover();
        await Task.WhenAny(movies, series);
        if (_discoverStale) BuildDiscover();
        await Task.WhenAll(movies, series);
        if (_discoverStale) BuildDiscover();
        UpdateDiscoverBusy();
        if (_tmdbRows != null) return;
        Hero.Error = null;
        Hero.IsLoading = true;
        UpdateDiscoverBusy();
        _tmdbTask ??= Task.Run(async () =>
        {
            try { await Tmdb.Check(key); }
            catch (Exception ex) { await App.Current.Dispatcher.InvokeAsync(() => Hero.Error = $"{ex.Message} Controlla la chiave nelle impostazioni, alla voce TMDB."); }
            var rows = await Tmdb.LoadRows(key);
            await App.Current.Dispatcher.InvokeAsync(() =>
            {
                if (TmdbKey != key) return;
                _tmdbRows = rows;
                Hero.IsLoading = false;
                UpdateDiscoverBusy();
                BuildDiscover();
            });
        });
        await _tmdbTask;
    }

    /// <summary>Le liste di TMDB diventano righe di titoli del catalogo, più le righe del catalogo stesso.</summary>
    private void BuildDiscover()
    {
        _discoverStale = false;
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
        if (_myListOpen)
        {
            // "La mia lista": una pagina tutta sua, i titoli a righe di otto nell'ordine in cui li hai aggiunti.
            var page = new List<object> { new DiscoverHeading($"La mia lista · {(mine.Count == 1 ? "1 titolo" : $"{mine.Count} titoli")}") };
            if (mine.Count == 0) page.Add(new DiscoverHeading("La lista è vuota: aggiungi film e serie con + dalla loro scheda."));
            for (var n = 0; n < mine.Count; n += 8) page.Add(new DiscoverRow("", mine.Skip(n).Take(8).ToList()));
            DiscoverItems = page;
            return;
        }
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
        var cats = new List<DiscoverCat>();
        if (_discoverFilter != "tv")
        {
            var n = _movies.GroupBy(m => m.CategoryId ?? "").ToDictionary(g => g.Key, g => g.Count());
            cats.AddRange(_vodCats.Where(c => n.GetValueOrDefault(c.Id) > 0).Select(c => new DiscoverCat(c.Name, n[c.Id], LibraryMode.Movies, c.Id)));
        }
        if (_discoverFilter != "movie")
        {
            var n = _series.GroupBy(s => s.CategoryId ?? "").ToDictionary(g => g.Key, g => g.Count());
            cats.AddRange(_seriesCats.Where(c => n.GetValueOrDefault(c.Id) > 0).Select(c => new DiscoverCat(c.Name + " · Serie", n[c.Id], LibraryMode.Series, c.Id)));
        }
        items.Add(new DiscoverCatGrid(cats));

        DiscoverItems = items;
        OnPropertyChanged(nameof(DiscoverMovieCategories));
        OnPropertyChanged(nameof(DiscoverSeriesCategories));
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
    private void DiscoverSeeAll(DiscoverRow? r)
    {
        if (r?.All is not { } a) return;
        // Tornando a "Film e serie" la pagina è ancora allo stesso punto: le righe non si rifanno.
        OpenDiscoverCategory(a.Mode, a.Id);
    }

    [RelayCommand]
    private void OpenDiscoverCat(DiscoverCat? c) { if (c != null) OpenDiscoverCategory(c.Mode, c.Id); }

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
