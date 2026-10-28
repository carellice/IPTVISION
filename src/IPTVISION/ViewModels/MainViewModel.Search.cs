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
        if (_client != null && (_moviesTask == null || _seriesTask == null))
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
        var channels = Rank(_all, c => c.SearchKey, q)
            .Concat(isNumber ? _all.Where(c => c.Num.ToString().StartsWith(q, StringComparison.Ordinal)) : [])
            .Distinct().Take(MaxHitsPerKind)
            .Select(c => new SearchHit(c, "Canale", c.Name, c.NowTitle ?? (c.Num > 0 ? $"Canale {c.Num}" : null)));
        var movies = Rank(_movies, m => m.SearchKey, q).Take(MaxHitsPerKind)
            .Select(m => new SearchHit(m, "Film", m.Name, m.Meta));
        var series = Rank(_series, s => s.SearchKey, q).Take(MaxHitsPerKind)
            .Select(s => new SearchHit(s, "Serie TV", s.Name, s.Meta));

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
        AddGroup("Canali", channels);
        AddGroup("Film", movies);
        AddGroup("Serie TV", series);

        SearchResults = results;
        SearchHits = hits;
        NotifyCounts();
        OnSearchUpdated();
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
            case Movie m: PlayMovie(m); break;
            case Series s: _ = OpenSeriesDetail(s); break;
        }
    }
}
