using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;

namespace IPTVISION.ViewModels;

public enum ListSort { Default, Number, NameAsc, NameDesc, Recent, Year, Rating }

public sealed record SortOption(ListSort Value, string Label);

public enum SearchScope { All, Channels, Movies, Series }

/// <summary>Una riga della vista a griglia del pannello (si virtualizzano le righe, non i riquadri).</summary>
public sealed record GridRow(IReadOnlyList<object> Items, int Columns);

/// <summary>
/// Come si sfoglia il catalogo: ordinamento ed elenco/griglia per ogni sezione,
/// ambito della ricerca e titoli pubblicati più volte raggruppati in un solo elemento.
/// </summary>
public sealed partial class MainViewModel
{
    private const int GridColumns = 3;

    private static readonly SortOption[] LiveSorts =
    [
        new(ListSort.Default, "Predefinito"),
        new(ListSort.Number, "Numero"),
        new(ListSort.NameAsc, "Nome (A-Z)"),
        new(ListSort.NameDesc, "Nome (Z-A)"),
    ];

    private static readonly SortOption[] MovieSorts =
    [
        new(ListSort.Default, "Predefinito"),
        new(ListSort.Recent, "Aggiunti di recente"),
        new(ListSort.NameAsc, "Nome (A-Z)"),
        new(ListSort.NameDesc, "Nome (Z-A)"),
        new(ListSort.Year, "Anno (più recenti)"),
        new(ListSort.Rating, "Voto"),
    ];

    private static readonly SortOption[] SeriesSorts =
    [
        new(ListSort.Default, "Predefinito"),
        new(ListSort.NameAsc, "Nome (A-Z)"),
        new(ListSort.NameDesc, "Nome (Z-A)"),
        new(ListSort.Year, "Anno (più recenti)"),
        new(ListSort.Rating, "Voto"),
    ];

    private int _gridIndex = -1;
    private List<object> _gridItems = [];

    // ---------- Ordinamento e vista ----------

    public IReadOnlyList<SortOption> SortOptions => Mode switch
    {
        LibraryMode.Movies => MovieSorts,
        LibraryMode.Series => SeriesSorts,
        _ => LiveSorts,
    };

    [ObservableProperty] private SortOption? _selectedSort;
    [ObservableProperty] private bool _isGridView;
    [ObservableProperty] private IReadOnlyList<GridRow> _gridRows = [];

    public bool ShowGridList => !IsSearchActive && IsCategoryOpen && IsGridView;

    /// <summary>Sezione corrente → chiave usata nelle impostazioni.</summary>
    private string ModeKey => Mode.ToString();

    /// <summary>Allinea ordinamento e vista alle preferenze salvate della sezione aperta.</summary>
    private void LoadBrowsePrefs()
    {
        _suspendFilter = true;
        OnPropertyChanged(nameof(SortOptions));
        var saved = _settings.ListSort.GetValueOrDefault(ModeKey);
        SelectedSort = SortOptions.FirstOrDefault(o => o.Value.ToString() == saved) ?? SortOptions[0];
        IsGridView = _settings.GridViews.Contains(ModeKey);
        _suspendFilter = false;
    }

    partial void OnSelectedSortChanged(SortOption? value)
    {
        if (_suspendFilter || value == null) return;
        _settings.ListSort[ModeKey] = value.Value.ToString();
        ScheduleSave();
        ApplyFilter();
        RefreshTvItems();
    }

    partial void OnIsGridViewChanged(bool value)
    {
        if (_suspendFilter) return;
        if (value) _settings.GridViews.Add(ModeKey); else _settings.GridViews.Remove(ModeKey);
        ScheduleSave();
        BuildGridRows();
        UpdateViewFlags();
    }

    [RelayCommand]
    private void SetListView() => IsGridView = false;

    [RelayCommand]
    private void SetGridView() => IsGridView = true;

    private List<Channel> SortChannels(List<Channel> list) => SelectedSort?.Value switch
    {
        ListSort.Number => list.OrderBy(c => c.Num <= 0 ? int.MaxValue : c.Num).ToList(),
        ListSort.NameAsc => list.OrderBy(c => c.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.NameDesc => list.OrderByDescending(c => c.SearchKey, StringComparer.Ordinal).ToList(),
        _ => list,
    };

    private List<Movie> SortMovies(List<Movie> list) => SelectedSort?.Value switch
    {
        ListSort.Recent => list.OrderByDescending(m => m.Data.Added).ToList(),
        ListSort.NameAsc => list.OrderBy(m => m.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.NameDesc => list.OrderByDescending(m => m.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.Year => list.OrderByDescending(m => YearValue(m.Data.Year)).ThenBy(m => m.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.Rating => list.OrderByDescending(m => m.Data.Rating).ThenBy(m => m.SearchKey, StringComparer.Ordinal).ToList(),
        _ => list,
    };

    private List<Series> SortSeries(List<Series> list) => SelectedSort?.Value switch
    {
        ListSort.NameAsc => list.OrderBy(s => s.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.NameDesc => list.OrderByDescending(s => s.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.Year => list.OrderByDescending(s => YearValue(s.Data.Year)).ThenBy(s => s.SearchKey, StringComparer.Ordinal).ToList(),
        ListSort.Rating => list.OrderByDescending(s => s.Data.Rating).ThenBy(s => s.SearchKey, StringComparer.Ordinal).ToList(),
        _ => list,
    };

    private static int YearValue(string? year) => int.TryParse(year, out var y) ? y : 0;

    // ---------- Griglia del pannello ----------

    private void BuildGridRows()
    {
        SetGridSelection(-1);
        if (!IsGridView || SelectedCategory == null)
        {
            _gridItems = [];
            GridRows = [];
            return;
        }
        _gridItems = Mode switch
        {
            LibraryMode.Movies => VisibleMovies.Cast<object>().ToList(),
            LibraryMode.Series => VisibleSeries.Cast<object>().ToList(),
            _ => VisibleChannels.Cast<object>().ToList(),
        };
        var rows = new List<GridRow>();
        for (var i = 0; i < _gridItems.Count; i += GridColumns)
            rows.Add(new GridRow(_gridItems.Skip(i).Take(GridColumns).ToList(), GridColumns));
        GridRows = rows;
    }

    private void SetGridSelection(int index)
    {
        if (_gridIndex >= 0 && _gridIndex < _gridItems.Count) SetGridFlag(_gridItems[_gridIndex], false);
        _gridIndex = index;
        if (_gridIndex >= 0 && _gridIndex < _gridItems.Count) SetGridFlag(_gridItems[_gridIndex], true);
    }

    private static void SetGridFlag(object item, bool value)
    {
        switch (item)
        {
            case Channel c: c.IsGridSelected = value; break;
            case ArtworkItem a: a.IsGridSelected = value; break;
        }
    }

    /// <summary>Sposta la selezione nella griglia; restituisce la riga da rendere visibile.</summary>
    public GridRow? GridMove(int dx, int dy)
    {
        if (_gridItems.Count == 0) return null;
        var i = _gridIndex < 0 ? 0 : Math.Clamp(_gridIndex + dx + dy * GridColumns, 0, _gridItems.Count - 1);
        SetGridSelection(i);
        return GridRows[i / GridColumns];
    }

    public void GridSelect(object item)
    {
        var i = _gridItems.IndexOf(item);
        if (i >= 0) SetGridSelection(i);
    }

    public object? GridSelectedItem => _gridIndex >= 0 && _gridIndex < _gridItems.Count ? _gridItems[_gridIndex] : null;

    // ---------- Ambito della ricerca ----------

    [ObservableProperty] private SearchScope _searchScope = SearchScope.All;

    public bool IsScopeAll { get => SearchScope == SearchScope.All; set { if (value) SearchScope = SearchScope.All; } }
    public bool IsScopeChannels { get => SearchScope == SearchScope.Channels; set { if (value) SearchScope = SearchScope.Channels; } }
    public bool IsScopeMovies { get => SearchScope == SearchScope.Movies; set { if (value) SearchScope = SearchScope.Movies; } }
    public bool IsScopeSeries { get => SearchScope == SearchScope.Series; set { if (value) SearchScope = SearchScope.Series; } }

    partial void OnSearchScopeChanged(SearchScope value)
    {
        OnPropertyChanged(nameof(IsScopeAll));
        OnPropertyChanged(nameof(IsScopeChannels));
        OnPropertyChanged(nameof(IsScopeMovies));
        OnPropertyChanged(nameof(IsScopeSeries));
        OnPropertyChanged(nameof(SearchPlaceholder));
        RunSearch();
    }

    [RelayCommand]
    private void SetSearchScope(SearchScope scope) => SearchScope = scope;

    // ---------- Titoli pubblicati più volte ----------

    /// <summary>
    /// Raggruppa le copie dello stesso titolo (stesso nome a parte le sigle di qualità):
    /// resta il primo nell'ordine della lista, con tutte le versioni in <see cref="ArtworkItem.Variants"/>.
    /// </summary>
    private static List<T> GroupVariants<T>(IEnumerable<T> items) where T : ArtworkItem
    {
        var groups = new Dictionary<string, List<T>>(StringComparer.Ordinal);
        var order = new List<T>();
        foreach (var item in items)
        {
            var key = TextHelpers.VariantKey(item.ItemName);
            if (groups.TryGetValue(key, out var g)) { g.Add(item); continue; }
            groups[key] = [item];
            order.Add(item);
        }
        foreach (var head in order)
        {
            var g = groups[TextHelpers.VariantKey(head.ItemName)];
            foreach (var other in g.Skip(1)) other.Variants = [];
            head.Variants = g.Count > 1 ? g.Cast<ArtworkItem>().ToList() : [];
            if (g.Count > 1) head.Progress = g.Max(v => v.Progress);
        }
        return order;
    }

    /// <summary>Il titolo per cui si sta scegliendo la versione (null = scelta chiusa).</summary>
    [ObservableProperty] private ArtworkItem? _variantOwner;
    [ObservableProperty] private IReadOnlyList<ArtworkItem> _variantChoices = [];

    public bool IsVariantChooserOpen => VariantOwner != null;

    // Il video è una finestra nativa che copre la grafica WPF: sul desktop la scelta compare nel pannello,
    // in modalità TV (dove i riquadri nascondono il video) a schermo intero.
    public bool ShowVariantOverlay => IsVariantChooserOpen && ShowTvLayer;
    public bool ShowVariantPanel => IsVariantChooserOpen && !ShowTvLayer;

    partial void OnVariantOwnerChanged(ArtworkItem? value) => NotifyVariantChooser();

    private void NotifyVariantChooser()
    {
        OnPropertyChanged(nameof(IsVariantChooserOpen));
        OnPropertyChanged(nameof(ShowVariantOverlay));
        OnPropertyChanged(nameof(ShowVariantPanel));
    }

    /// <summary>Film dalle liste: se ne esistono più versioni si sceglie prima quale.</summary>
    public void OpenMovie(Movie m)
    {
        if (m.HasVariants) ShowVariants(m);
        else PlayMovie(m);
    }

    /// <summary>Serie dalle liste: se ne esistono più versioni si sceglie prima quale.</summary>
    public void OpenSeriesItem(Series s)
    {
        if (s.HasVariants) ShowVariants(s);
        else OpenSeriesFromList(s);
    }

    private void ShowVariants(ArtworkItem item)
    {
        foreach (var v in item.Variants)
            if (v is Movie m) m.Progress = _positions.GetProgress(m.Key);
        VariantChoices = item.Variants;
        VariantOwner = item;
    }

    [RelayCommand]
    public void ChooseVariant(ArtworkItem? item)
    {
        if (item == null || VariantOwner == null) return;
        VariantOwner = null;
        VariantChoices = [];
        switch (item)
        {
            case Movie m:
                PlayMovie(m);
                if (IsTvMode) IsTvBrowsing = false;
                break;
            case Series s:
                OpenSeriesFromList(s);
                break;
        }
    }

    [RelayCommand]
    public void CloseVariants()
    {
        VariantOwner = null;
        VariantChoices = [];
    }

    private void OpenSeriesFromList(Series s)
    {
        if (IsTvMode) _ = ShowTvSeries(s);
        else _ = OpenSeriesDetail(s);
    }
}
