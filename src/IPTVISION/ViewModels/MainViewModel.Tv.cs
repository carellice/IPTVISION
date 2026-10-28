using System.Globalization;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using IPTVISION.Models;

namespace IPTVISION.ViewModels;

/// <summary>
/// Modalità TV: interfaccia a schermo intero, a riquadri grandi, guidata solo da
/// frecce, OK e Indietro (tastiera, telecomando per PC o controller).
/// La selezione è tenuta qui (IsTvFocused sugli elementi), non nel focus di WPF:
/// così lo spostamento è sempre prevedibile anche con liste virtualizzate.
/// </summary>
public sealed partial class MainViewModel
{
    private static readonly CultureInfo Italian = CultureInfo.GetCultureInfo("it-IT");

    private DispatcherTimer _clockTimer = null!;
    private List<object> _tvItems = [];
    private int _tvCols = 4;
    private int _tvIndex;
    private int _tabIndex;
    private int _seasonIndex;
    private object? _tvFocused;
    private CategoryItem? _tvCategory;
    private int _tvCategoryIndex;
    private int _tvItemIndex;
    private bool _seriesFromSearch;

    public List<TvTab> TvTabs { get; } =
    [
        new(TvSection.Live, "TV in diretta", ""),
        new(TvSection.Movies, "Film", ""),
        new(TvSection.Series, "Serie TV", ""),
        new(TvSection.Search, "Cerca", ""),
        new(TvSection.Exit, "Esci", ""),
    ];

    [ObservableProperty] private bool _isTvMode;
    [ObservableProperty] private bool _isTvBrowsing;
    [ObservableProperty] private TvScreen _tvScreen;
    [ObservableProperty] private TvZone _tvZone = TvZone.Grid;
    [ObservableProperty] private string _tvHeading = "";
    [ObservableProperty] private string? _tvSubheading;
    [ObservableProperty] private IReadOnlyList<TvRow> _tvRows = [];
    [ObservableProperty] private string _tvClock = "";
    [ObservableProperty] private string _tvDate = "";

    public bool ShowTvLayer => IsTvMode && IsTvBrowsing;
    public bool ShowVideo => !ShowTvLayer;
    public bool IsTvSearchScreen => TvScreen == TvScreen.Search;
    public bool IsTvSeriesScreen => TvScreen == TvScreen.Series;
    public bool IsTvSearchZone => TvZone == TvZone.Search;

    /// <summary>La vista porta in vista la riga indicata.</summary>
    public event Action<int>? TvScrollRequested;

    /// <summary>La vista dà il focus di tastiera alla casella di ricerca (o lo toglie).</summary>
    public event Action<bool>? TvSearchFocusRequested;

    /// <summary>La vista avvia la dettatura vocale di Windows nella casella di ricerca attiva.</summary>
    public event Action? VoiceSearchRequested;

    public bool StartInTvMode
    {
        get => _settings.StartInTvMode;
        set
        {
            _settings.StartInTvMode = value;
            OnPropertyChanged();
            ScheduleSave();
        }
    }

    private void InitTv()
    {
        UpdateClock();
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        _clockTimer.Tick += (_, _) => UpdateClock();
        _clockTimer.Start();
    }

    private void UpdateClock()
    {
        var now = DateTime.Now;
        TvClock = now.ToString("HH:mm", Italian);
        var date = now.ToString("dddd d MMMM", Italian);
        TvDate = char.ToUpper(date[0], Italian) + date[1..];
    }

    partial void OnIsTvModeChanged(bool value) => NotifyTvLayer();

    partial void OnIsTvBrowsingChanged(bool value)
    {
        NotifyTvLayer();
        if (value && IsTvMode) FocusCurrent();
    }

    partial void OnTvScreenChanged(TvScreen value)
    {
        OnPropertyChanged(nameof(IsTvSearchScreen));
        OnPropertyChanged(nameof(IsTvSeriesScreen));
    }

    partial void OnTvZoneChanged(TvZone value)
    {
        OnPropertyChanged(nameof(IsTvSearchZone));
        TvSearchFocusRequested?.Invoke(value == TvZone.Search);
    }

    private void NotifyTvLayer()
    {
        OnPropertyChanged(nameof(ShowTvLayer));
        OnPropertyChanged(nameof(ShowVideo));
    }

    // ---------- Entrata / uscita ----------

    public void EnterTvMode()
    {
        if (!IsLoggedIn) return;
        IsSettingsOpen = false;
        IsTvMode = true;
        var section = Mode switch
        {
            LibraryMode.Movies => TvSection.Movies,
            LibraryMode.Series => TvSection.Series,
            _ => TvSection.Live,
        };
        TvSelectSection(section);
        TvZone = _tvItems.Count > 0 ? TvZone.Grid : TvZone.Tabs;
        IsTvBrowsing = true;
        FocusCurrent();
    }

    public void ExitTvMode()
    {
        Focus(null);
        IsTvBrowsing = false;
        IsTvMode = false;
    }

    /// <summary>Dal video torna ai riquadri (tasto Indietro/Menu mentre si guarda).</summary>
    public void ShowTvBrowser()
    {
        if (!IsTvMode) return;
        IsTvBrowsing = true;
    }

    // ---------- Schermate ----------

    private void TvSelectSection(TvSection section)
    {
        _tabIndex = Math.Max(0, TvTabs.FindIndex(t => t.Section == section));
        foreach (var t in TvTabs) t.IsActive = t.Section == section;

        if (section == TvSection.Search)
        {
            CloseSeriesForTv();
            TvScreen = TvScreen.Search;
            TvHeading = "Cerca";
            TvSubheading = "Canali, film e serie TV. Premi OK sulla casella per dettare con la voce.";
            SetTvItems(SearchHits, 1, 0);
            return;
        }

        var mode = section switch
        {
            TvSection.Movies => LibraryMode.Movies,
            TvSection.Series => LibraryMode.Series,
            _ => LibraryMode.Live,
        };
        _tvCategoryIndex = 0;
        if (Mode != mode) Mode = mode; // carica il catalogo e ricostruisce le categorie
        ShowTvCategories(0);
    }

    private void ShowTvCategories(int index)
    {
        CloseSeriesForTv();
        _tvCategory = null;
        SelectedCategory = null;
        TvScreen = TvScreen.Categories;
        TvHeading = Mode switch
        {
            LibraryMode.Movies => "Film",
            LibraryMode.Series => "Serie TV",
            _ => "TV in diretta",
        };
        TvSubheading = Categories.Count == 1 ? "1 categoria" : $"{Categories.Count} categorie";
        SetTvItems(Categories.Cast<object>().ToList(), 4, index);
    }

    private void ShowTvItems(CategoryItem c, int index = -1)
    {
        _tvCategory = c;
        SelectedCategory = c;
        TvScreen = TvScreen.Items;
        TvHeading = c.Name;
        IReadOnlyList<object> items = Mode switch
        {
            LibraryMode.Movies => VisibleMovies.Cast<object>().ToList(),
            LibraryMode.Series => VisibleSeries.Cast<object>().ToList(),
            _ => VisibleChannels.Cast<object>().ToList(),
        };
        TvSubheading = ItemCountText;
        if (index < 0)
        {
            // Si parte da ciò che è in riproduzione, se è in questa categoria.
            object? playing = (object?)CurrentMovie ?? (object?)_playingSeries ?? (IsVod ? null : CurrentChannel);
            index = playing == null ? 0 : Math.Max(0, IndexOfItem(items, playing));
        }
        SetTvItems(items, Mode == LibraryMode.Live ? 4 : 6, index);
    }

    private async Task ShowTvSeries(Series s)
    {
        _tvItemIndex = _tvIndex;
        _seriesFromSearch = TvScreen == TvScreen.Search;
        TvScreen = TvScreen.Series;
        TvHeading = s.Name;
        TvSubheading = s.Meta;
        SetTvItems([], 1, 0);
        await OpenSeriesDetail(s);
        if (TvScreen != TvScreen.Series || OpenSeries != s) return;
        TvSubheading = OpenSeriesMeta;
        _seasonIndex = Math.Max(0, IndexOfItem(Seasons.Cast<object>().ToList(), SelectedSeason));
        ShowTvEpisodes();
    }

    private void ShowTvEpisodes()
    {
        var eps = VisibleEpisodes.Cast<object>().ToList();
        var index = CurrentEpisode == null ? -1 : IndexOfItem(eps, CurrentEpisode);
        if (index < 0 && OpenSeries != null && _positions.GetLastEpisode(OpenSeries.SeriesId)?.EpisodeId is { } lastId)
            index = eps.FindIndex(e => e is Episode ep && ep.Id == lastId);
        SetTvItems(eps, 1, Math.Max(0, index));
        foreach (var season in Seasons) season.IsActive = season == SelectedSeason;
    }

    private void CloseSeriesForTv()
    {
        if (OpenSeries != null) OpenSeries = null;
    }

    /// <summary>Richiamato quando cambiano le categorie (catalogo appena caricato o aggiornato).</summary>
    private void OnCategoriesRebuilt()
    {
        if (IsTvMode && TvScreen == TvScreen.Categories && SelectedCategory == null)
        {
            TvSubheading = Categories.Count == 1 ? "1 categoria" : $"{Categories.Count} categorie";
            SetTvItems(Categories.Cast<object>().ToList(), 4, _tvIndex);
        }
    }

    /// <summary>Richiamato quando cambiano i risultati della ricerca.</summary>
    private void OnSearchUpdated()
    {
        if (IsTvMode && TvScreen == TvScreen.Search)
        {
            SetTvItems(SearchHits, 1, 0);
            TvSubheading = IsSearchActive
                ? (SearchHits.Count == 1 ? "1 risultato" : $"{SearchHits.Count} risultati")
                : "Canali, film e serie TV. Premi OK sulla casella per dettare con la voce.";
        }
    }

    /// <summary>Richiamato quando cambia la stagione nel dettaglio serie.</summary>
    private void OnEpisodesShown()
    {
        if (IsTvMode && TvScreen == TvScreen.Series) ShowTvEpisodes();
    }

    private static int IndexOfItem(IReadOnlyList<object> items, object? item)
    {
        for (var i = 0; i < items.Count; i++) if (ReferenceEquals(items[i], item)) return i;
        return -1;
    }

    private void SetTvItems(IReadOnlyList<object> items, int cols, int index)
    {
        _tvItems = items.ToList();
        _tvCols = Math.Max(1, cols);
        var rows = new List<TvRow>();
        for (var i = 0; i < _tvItems.Count; i += _tvCols)
            rows.Add(new TvRow(_tvItems.Skip(i).Take(_tvCols).ToList(), _tvCols));
        TvRows = rows;
        _tvIndex = _tvItems.Count == 0 ? 0 : Math.Clamp(index, 0, _tvItems.Count - 1);
        if (TvZone == TvZone.Grid) FocusCurrent();
    }

    // ---------- Selezione ----------

    private void Focus(object? item)
    {
        if (ReferenceEquals(_tvFocused, item)) return;
        SetFocusFlag(_tvFocused, false);
        _tvFocused = item;
        SetFocusFlag(item, true);
    }

    private static void SetFocusFlag(object? item, bool value)
    {
        switch (item)
        {
            case Channel c: c.IsTvFocused = value; break;
            case ArtworkItem a: a.IsTvFocused = value; break;
            case CategoryItem c: c.IsTvFocused = value; break;
            case SeasonItem s: s.IsTvFocused = value; break;
            case SearchHit h: h.IsTvFocused = value; break;
            case TvTab t: t.IsTvFocused = value; break;
        }
    }

    private void FocusCurrent()
    {
        if (!IsTvMode) return;
        switch (TvZone)
        {
            case TvZone.Tabs:
                Focus(TvTabs[_tabIndex]);
                break;
            case TvZone.Search:
                Focus(null);
                break;
            case TvZone.Seasons when Seasons.Count > 0:
                _seasonIndex = Math.Clamp(_seasonIndex, 0, Seasons.Count - 1);
                Focus(Seasons[_seasonIndex]);
                break;
            case TvZone.Grid when _tvItems.Count > 0:
                Focus(_tvItems[_tvIndex]);
                TvScrollRequested?.Invoke(_tvIndex / _tvCols);
                break;
            default:
                Focus(null);
                break;
        }
    }

    /// <summary>Zona sopra la griglia per la schermata corrente.</summary>
    private TvZone ZoneAboveGrid() => TvScreen switch
    {
        TvScreen.Search => TvZone.Search,
        TvScreen.Series when Seasons.Count > 0 => TvZone.Seasons,
        _ => TvZone.Tabs,
    };

    public void TvMove(int dx, int dy)
    {
        switch (TvZone)
        {
            case TvZone.Tabs:
                if (dx != 0)
                {
                    var next = Math.Clamp(_tabIndex + dx, 0, TvTabs.Count - 1);
                    if (next == _tabIndex) return;
                    _tabIndex = next;
                    var tab = TvTabs[next];
                    if (tab.Section != TvSection.Exit) TvSelectSection(tab.Section);
                }
                else if (dy > 0 && TvTabs[_tabIndex].Section != TvSection.Exit)
                {
                    var below = ZoneAboveGrid();
                    TvZone = below != TvZone.Tabs ? below : _tvItems.Count > 0 ? TvZone.Grid : TvZone.Tabs;
                }
                break;

            case TvZone.Search:
                if (dy < 0) TvZone = TvZone.Tabs;
                else if (dy > 0 && _tvItems.Count > 0) TvZone = TvZone.Grid;
                break;

            case TvZone.Seasons:
                if (dx != 0 && Seasons.Count > 0)
                {
                    var next = Math.Clamp(_seasonIndex + dx, 0, Seasons.Count - 1);
                    if (next == _seasonIndex) return;
                    _seasonIndex = next;
                    SelectedSeason = Seasons[next];
                }
                else if (dy < 0) TvZone = TvZone.Tabs;
                else if (dy > 0 && _tvItems.Count > 0) TvZone = TvZone.Grid;
                break;

            case TvZone.Grid:
                if (_tvItems.Count == 0)
                {
                    if (dy < 0) TvZone = ZoneAboveGrid();
                    break;
                }
                if (dx != 0)
                {
                    var col = _tvIndex % _tvCols + dx;
                    if (col < 0 || col >= _tvCols || _tvIndex + dx >= _tvItems.Count) return;
                    _tvIndex += dx;
                }
                else if (dy < 0)
                {
                    if (_tvIndex - _tvCols < 0) { TvZone = ZoneAboveGrid(); break; }
                    _tvIndex -= _tvCols;
                }
                else if (dy > 0)
                {
                    if (_tvIndex + _tvCols < _tvItems.Count) _tvIndex += _tvCols;
                    else if (_tvIndex / _tvCols < (_tvItems.Count - 1) / _tvCols) _tvIndex = _tvItems.Count - 1;
                    else return;
                }
                break;
        }
        FocusCurrent();
    }

    /// <summary>Pagina giù/su nella griglia (salto di più righe), utile negli elenchi lunghi.</summary>
    public void TvPage(int dir)
    {
        if (TvZone != TvZone.Grid || _tvItems.Count == 0) return;
        var rows = _tvCols == 1 ? 6 : 3;
        _tvIndex = Math.Clamp(_tvIndex + dir * rows * _tvCols, 0, _tvItems.Count - 1);
        FocusCurrent();
    }

    public void TvActivate()
    {
        switch (TvZone)
        {
            case TvZone.Tabs:
                if (TvTabs[_tabIndex].Section == TvSection.Exit) ExitTvMode();
                else TvMove(0, 1);
                return;
            case TvZone.Search:
                VoiceSearchRequested?.Invoke();
                return;
            case TvZone.Seasons:
                TvMove(0, 1);
                return;
        }

        if (_tvItems.Count == 0) return;
        TvActivateItem(_tvItems[_tvIndex]);
    }

    /// <summary>Apre o riproduce un elemento (anche col mouse, cliccando un riquadro).</summary>
    public void TvActivateItem(object item)
    {
        var i = _tvItems.IndexOf(item);
        if (i >= 0 && TvZone == TvZone.Grid) _tvIndex = i;

        switch (item)
        {
            case CategoryItem c:
                _tvCategoryIndex = _tvIndex;
                ShowTvItems(c);
                break;
            case Series s:
                _ = ShowTvSeries(s);
                break;
            case SearchHit { Item: Series s }:
                _ = ShowTvSeries(s);
                break;
            case SearchHit h:
                ActivateSearchHit(h);
                IsTvBrowsing = false;
                break;
            case Channel c:
                PlayChannel(c);
                IsTvBrowsing = false;
                break;
            case Movie m:
                PlayMovie(m);
                IsTvBrowsing = false;
                break;
            case Episode e:
                PlayEpisode(e);
                IsTvBrowsing = false;
                break;
        }
    }

    public void TvBack()
    {
        if (TvZone == TvZone.Tabs)
        {
            if (Player.IsActive || IsVod) IsTvBrowsing = false;
            return;
        }

        switch (TvScreen)
        {
            case TvScreen.Series:
                CloseSeriesForTv();
                if (_seriesFromSearch)
                {
                    // Aperta dai risultati di ricerca: si torna lì.
                    TvScreen = TvScreen.Search;
                    TvHeading = "Cerca";
                    TvZone = TvZone.Grid;
                    SetTvItems(SearchHits, 1, _tvItemIndex);
                }
                else if (_tvCategory != null)
                {
                    TvZone = TvZone.Grid;
                    ShowTvItems(_tvCategory, _tvItemIndex);
                }
                else ShowTvCategories(_tvCategoryIndex);
                break;
            case TvScreen.Items:
                TvZone = TvZone.Grid;
                ShowTvCategories(_tvCategoryIndex);
                break;
            default:
                TvZone = TvZone.Tabs;
                break;
        }
        FocusCurrent();
    }

    /// <summary>LB/RB del controller o PagSu/PagGiù: scheda precedente/successiva.</summary>
    public void TvSwitchTab(int dir)
    {
        var next = _tabIndex + dir;
        if (next < 0 || next >= TvTabs.Count || TvTabs[next].Section == TvSection.Exit) return;
        _tabIndex = next;
        TvSelectSection(TvTabs[next].Section);
        if (TvZone != TvZone.Tabs) TvZone = TvScreen == TvScreen.Search ? TvZone.Search : (_tvItems.Count > 0 ? TvZone.Grid : TvZone.Tabs);
        FocusCurrent();
    }
}
