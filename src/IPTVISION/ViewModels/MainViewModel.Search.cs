using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;

namespace IPTVISION.ViewModels;

/// <summary>Ricerca unica su canali, film e serie, a prescindere dalla sezione aperta.</summary>
public sealed partial class MainViewModel
{
    private const int MaxHitsPerKind = 60;

    /// <summary>Intestazioni (SearchHeader) e risultati (SearchHit) in un'unica lista per il pannello.</summary>
    [ObservableProperty] private IReadOnlyList<object> _searchResults = [];

    /// <summary>Solo i risultati, nell'ordine mostrato: usati dalla griglia della modalità TV.</summary>
    [ObservableProperty] private IReadOnlyList<SearchHit> _searchHits = [];

    [ObservableProperty] private bool _isSearchCatalogLoading;

    public int SearchHitCount => SearchHits.Count;

    private void RunSearch()
    {
        var q = TextHelpers.Normalize(SearchText ?? "");
        if (q.Length == 0)
        {
            SearchResults = [];
            SearchHits = [];
            NotifyCounts();
            OnSearchUpdated();
            return;
        }

        // Film e serie si caricano solo quando servono: la prima ricerca li richiede in background.
        if (_client != null && SearchScope != SearchScope.Channels && (_moviesTask == null || _seriesTask == null))
        {
            IsSearchCatalogLoading = true;
            var pending = Task.WhenAll(EnsureMoviesAsync(), EnsureSeriesAsync());
            _ = pending.ContinueWith(_ =>
            {
                IsSearchCatalogLoading = false;
                if (IsSearchActive) RunSearch();
            }, TaskScheduler.FromCurrentSynchronizationContext());
        }

        var isNumber = q.All(char.IsDigit);
        var scope = SearchScope;
        IEnumerable<SearchHit> channels = scope is not (SearchScope.All or SearchScope.Channels) ? [] : Rank(_all, c => c.SearchKey, q)
            .Concat(isNumber ? _all.Where(c => c.Num.ToString().StartsWith(q, StringComparison.Ordinal)) : [])
            .Distinct().Take(MaxHitsPerKind)
            .Select(c => new SearchHit(c, "Canale", c.Name, c.NowTitle ?? (c.Num > 0 ? $"Canale {c.Num}" : null)));
        // Le copie dello stesso titolo diventano un solo risultato, con il numero di versioni.
        IEnumerable<SearchHit> movies = scope is not (SearchScope.All or SearchScope.Movies) ? [] : GroupVariants(Rank(_movies, m => m.SearchKey, q)).Take(MaxHitsPerKind)
            .Select(m => new SearchHit(m, "Film", m.Name, m.HasVariants ? TextHelpers.JoinMeta(m.Meta, m.VariantsText) : m.Meta));
        IEnumerable<SearchHit> series = scope is not (SearchScope.All or SearchScope.Series) ? [] : GroupVariants(Rank(_series, s => s.SearchKey, q)).Take(MaxHitsPerKind)
            .Select(s => new SearchHit(s, "Serie TV", s.Name, s.HasVariants ? TextHelpers.JoinMeta(s.Meta, s.VariantsText) : s.Meta));

        // Anche le categorie: "azione", "sport", "bambini"...
        IEnumerable<SearchHit> categories = MatchCategories(scope, q)
            .Select(c => new SearchHit(c, "Categoria", c.Name, c.Mode switch
            {
                LibraryMode.Movies => $"Film · {c.Count} titoli",
                LibraryMode.Series => $"Serie TV · {c.Count} serie",
                _ => $"TV in diretta · {c.Count} canali",
            }));

        var results = new List<object>();
        var hits = new List<SearchHit>();
        void AddGroup(string title, IEnumerable<SearchHit> group)
        {
            var list = group.ToList();
            if (list.Count == 0) return;
            results.Add(new SearchHeader(title, list.Count));
            results.AddRange(list);
            hits.AddRange(list);
        }
        AddGroup("Categorie", categories);
        AddGroup("Canali", channels);
        AddGroup("Film", movies);
        AddGroup("Serie TV", series);

        SearchResults = results;
        SearchHits = hits;
        NotifyCounts();
        OnSearchUpdated();
    }

    /// <summary>Le categorie (con almeno un contenuto) il cui nome contiene il testo cercato.</summary>
    private IEnumerable<CategoryHit> MatchCategories(SearchScope scope, string q)
    {
        IEnumerable<CategoryHit> Of(LibraryMode mode, List<Category> cats, IEnumerable<string?> ids)
        {
            var counts = ids.Where(id => id != null).GroupBy(id => id!).ToDictionary(g => g.Key, g => g.Count());
            return Rank(cats.Where(c => counts.ContainsKey(c.Id)), c => TextHelpers.Normalize(c.Name), q)
                .Select(c => new CategoryHit(mode, c.Id, c.Name, counts[c.Id]));
        }
        var hits = Enumerable.Empty<CategoryHit>();
        if (scope is SearchScope.All or SearchScope.Channels) hits = hits.Concat(Of(LibraryMode.Live, _liveCats, _all.Select(c => c.CategoryId)));
        if (scope is SearchScope.All or SearchScope.Movies) hits = hits.Concat(Of(LibraryMode.Movies, _vodCats, _movies.Select(m => m.CategoryId)));
        if (scope is SearchScope.All or SearchScope.Series) hits = hits.Concat(Of(LibraryMode.Series, _seriesCats, _series.Select(s => s.CategoryId)));
        return hits.Take(MaxHitsPerKind);
    }

    /// <summary>Apre la sezione della categoria trovata, con quella categoria aperta.</summary>
    private void OpenCategoryHit(CategoryHit c)
    {
        _modeCategory[c.Mode] = c.Id;
        SearchText = "";
        if (Mode != c.Mode) Mode = c.Mode; // ricostruisce le categorie e riapre quella scelta
        else SelectedCategory = Categories.FirstOrDefault(x => x.Id == c.Id);
    }

    /// <summary>Prima chi inizia con il testo cercato, poi chi lo contiene in una parola, poi il resto.</summary>
    private static IEnumerable<T> Rank<T>(IEnumerable<T> src, Func<T, string> key, string q) =>
        src.Select(x => (x, k: key(x)))
           .Where(t => t.k.Contains(q, StringComparison.Ordinal))
           .OrderBy(t => t.k.StartsWith(q, StringComparison.Ordinal) ? 0 : t.k.Contains(" " + q, StringComparison.Ordinal) ? 1 : 2)
           .ThenBy(t => t.k.Length)
           .Select(t => t.x);

    [RelayCommand]
    public void ActivateSearchHit(SearchHit? hit)
    {
        switch (hit?.Item)
        {
            case Channel c: PlayChannel(c); break;
            case Movie m: OpenMovie(m); break;
            case Series s: OpenSeriesItem(s); break;
            case CategoryHit c: OpenCategoryHit(c); break;
        }
    }
}
