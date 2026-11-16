using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using IPTVISION.Models;

namespace IPTVISION.Services;

/// <summary>
/// TMDB (themoviedb.org): copertine, tendenze e generi per la schermata "Film e serie".
/// Il catalogo resta quello del provider: TMDB sceglie e veste solo i titoli che ci sono.
/// Stessa logica di PWA/web/src/lib/tmdb.ts.
/// </summary>
public static partial class Tmdb
{
    public enum Kind { Movie, Tv }

    public sealed record Card(int Id, Kind Kind, string Title, string? Year, string Overview, string? Poster, string? Backdrop, double Vote, IReadOnlyList<string> Keys);

    public sealed record Row(string Id, string Title, IReadOnlyList<Card> Items, bool Top);

    public sealed class TmdbException(string message) : Exception(message);

    // shortcut: risposte tenute solo in memoria (a ogni avvio ~60 richieste), usare un file se TMDB inizia a limitare.
    private static readonly ConcurrentDictionary<string, Task<JsonElement>> Cache = new();
    // Al massimo 6 richieste insieme: la schermata ne chiede ~60 e TMDB risponde 429 alle raffiche.
    private static readonly SemaphoreSlim Gate = new(6);

    public static void ClearCache() => Cache.Clear();

    private static Task<JsonElement> Get(string key, string path, IDictionary<string, object>? args = null)
    {
        // I token v4 sono JWT ("eyJ..."), le chiavi v3 sono 32 caratteri esadecimali.
        var bearer = key.StartsWith("eyJ", StringComparison.Ordinal);
        var q = new List<string> { "language=it-IT" };
        if (args != null) q.AddRange(args.Select(a => $"{a.Key}={Uri.EscapeDataString(Convert.ToString(a.Value, System.Globalization.CultureInfo.InvariantCulture)!)}"));
        if (!bearer) q.Add("api_key=" + Uri.EscapeDataString(key));
        var url = $"https://api.themoviedb.org/3/{path}?{string.Join("&", q)}";
        var task = Cache.GetOrAdd(url, u => Fetch(u, bearer ? key : null));
        // Un errore non resta in memoria: la prossima volta si riprova.
        _ = task.ContinueWith(t => Cache.TryRemove(new KeyValuePair<string, Task<JsonElement>>(url, task)), TaskContinuationOptions.NotOnRanToCompletion);
        return task;
    }

    private static async Task<JsonElement> Fetch(string url, string? bearer, int tries = 3)
    {
        await Gate.WaitAsync();
        HttpResponseMessage r;
        string? body;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (bearer != null) req.Headers.Authorization = new("Bearer", bearer);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            try
            {
                r = await XtreamClient.Http.SendAsync(req, cts.Token);
                body = r.IsSuccessStatusCode ? await r.Content.ReadAsStringAsync(cts.Token) : null;
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException) { throw new TmdbException("TMDB non raggiungibile."); }
        }
        finally { Gate.Release(); }

        // Troppe richieste insieme: si aspetta quanto dice TMDB (o un secondo) e si riprova.
        if (r.StatusCode == HttpStatusCode.TooManyRequests && tries > 0)
        {
            await Task.Delay(r.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1));
            return await Fetch(url, bearer, tries - 1);
        }
        if (r.StatusCode == HttpStatusCode.Unauthorized) throw new TmdbException("Chiave TMDB non valida.");
        if (body == null) throw new TmdbException($"TMDB: errore {(int)r.StatusCode}");
        try { using var doc = JsonDocument.Parse(body); return doc.RootElement.Clone(); }
        catch (JsonException) { throw new TmdbException("TMDB: risposta non valida"); }
    }

    /// <summary>Lancia l'eccezione col motivo se la chiave non funziona.</summary>
    public static Task Check(string key) => Get(key.Trim(), "configuration");

    public static string? Img(string? path, string size = "w342") => path == null ? null : $"https://image.tmdb.org/t/p/{size}{path}";

    [GeneratedRegex(@"\b(19|20)\d\d\b")] private static partial Regex YearRx();
    [GeneratedRegex(@"\s+")] private static partial Regex SpacesRx();

    /// <summary>Lo stesso titolo, qualunque cosa abbia aggiunto il pannello: prefisso di lingua, sigle di qualità, anno.</summary>
    public static string MatchKey(string name) => SpacesRx().Replace(YearRx().Replace(TextHelpers.VariantKey(name), " "), " ").Trim();

    private static string Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static Card? ToCard(JsonElement o, Kind? kind)
    {
        Kind k;
        if (kind is Kind given) k = given;
        else if (Str(o, "media_type") == "movie") k = Kind.Movie;
        else if (Str(o, "media_type") == "tv") k = Kind.Tv;
        else return null;
        if (!o.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number) return null;
        var title = Str(o, "title") is { Length: > 0 } t ? t : Str(o, "name");
        var original = Str(o, "original_title") is { Length: > 0 } ot ? ot : Str(o, "original_name");
        var date = Str(o, "release_date") is { Length: > 0 } d ? d : Str(o, "first_air_date");
        var vote = o.TryGetProperty("vote_average", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
        return new Card(id.GetInt32(), k, title, date.Length >= 4 ? date[..4] : null, Str(o, "overview"),
            Str(o, "poster_path") is { Length: > 0 } p ? p : null, Str(o, "backdrop_path") is { Length: > 0 } b ? b : null, vote,
            new[] { MatchKey(title), MatchKey(original) }.Where(x => x.Length > 0).Distinct().ToList());
    }

    private static List<Card> Cards(JsonElement page, Kind? kind) =>
        page.TryGetProperty("results", out var a) && a.ValueKind == JsonValueKind.Array
            ? a.EnumerateArray().Select(o => ToCard(o, kind)).OfType<Card>().ToList()
            : [];

    // ---------- Le righe della schermata ----------

    private sealed record Source(Kind Kind, string Path, Dictionary<string, object> Args);

    private static IEnumerable<Source> Pages(Kind kind, string path, int n, Dictionary<string, object>? args = null) =>
        Enumerable.Range(1, n).Select(p => new Source(kind, path, new Dictionary<string, object>(args ?? []) { ["page"] = p }));

    private static IEnumerable<Source> Discover(Kind kind, int genre) => Pages(kind, kind == Kind.Movie ? "discover/movie" : "discover/tv", 2, new()
    {
        ["with_genres"] = genre, ["sort_by"] = "popularity.desc", ["vote_count.gte"] = kind == Kind.Movie ? 150 : 60,
    });

    /// <summary>Titolo, genere dei film, genere delle serie (TMDB ha due elenchi di generi diversi).</summary>
    private static readonly (string Title, int? Movie, int? Tv)[] Genres =
    [
        ("Azione e avventura", 28, 10759), ("Commedie", 35, 35), ("Fantascienza e fantasy", 878, 10765), ("Crime", 80, 80),
        ("Thriller e mistero", 53, 9648), ("Drammi", 18, 18), ("Animazione", 16, 16), ("Horror", 27, null),
        ("Romantici", 10749, null), ("Per tutta la famiglia", 10751, 10751), ("Documentari", 99, 99),
    ];

    private static readonly (string Id, string Title, bool Top, Source[] Sources)[] Defs =
    [
        ("top", "Top 10 di oggi", true, Pages(Kind.Movie, "trending/all/day", 3).ToArray()),
        ("trend", "Di tendenza questa settimana", false, Pages(Kind.Movie, "trending/all/week", 3).ToArray()),
        ("popm", "Film popolari", false, Pages(Kind.Movie, "movie/popular", 3).ToArray()),
        ("popt", "Serie TV popolari", false, Pages(Kind.Tv, "tv/popular", 3).ToArray()),
        ("best", "I più acclamati", false, Pages(Kind.Movie, "movie/top_rated", 3).Concat(Pages(Kind.Tv, "tv/top_rated", 3)).ToArray()),
        .. Genres.Select(g => ("g:" + g.Title, g.Title, false,
            (g.Movie is int m ? Discover(Kind.Movie, m) : []).Concat(g.Tv is int t ? Discover(Kind.Tv, t) : []).ToArray())),
    ];

    /// <summary>Film e serie affiancati: il primo dell'una, il primo dell'altra e così via.</summary>
    private static List<Card> Interleave(List<Card> a, List<Card> b)
    {
        var out_ = new List<Card>(a.Count + b.Count);
        for (var i = 0; i < Math.Max(a.Count, b.Count); i++)
        {
            if (i < a.Count) out_.Add(a[i]);
            if (i < b.Count) out_.Add(b[i]);
        }
        return out_;
    }

    public static async Task<List<Row>> LoadRows(string key)
    {
        var rows = await Task.WhenAll(Defs.Select(async d =>
        {
            var answers = await Task.WhenAll(d.Sources.Select(async s =>
            {
                // trending/all mescola i due: il tipo arriva con ogni risultato.
                try { return Cards(await Get(key, s.Path, s.Args), s.Path.StartsWith("trending") ? null : s.Kind); }
                catch (Exception) { return []; }
            }));
            var items = d.Sources.Any(s => s.Path.StartsWith("trending"))
                ? answers.SelectMany(x => x).ToList()
                : Interleave(answers.Where((_, i) => d.Sources[i].Kind == Kind.Movie).SelectMany(x => x).ToList(),
                             answers.Where((_, i) => d.Sources[i].Kind == Kind.Tv).SelectMany(x => x).ToList());
            return new Row(d.Id, d.Title, items, d.Top);
        }));
        return rows.ToList();
    }

    /// <summary>La scheda TMDB di un titolo del catalogo (continua a guardare, la mia lista).</summary>
    public static async Task<Card?> Lookup(string key, Kind kind, string name, string? year)
    {
        var query = MatchKey(name);
        if (query.Length == 0 || key.Length == 0) return null;
        try
        {
            var list = Cards(await Get(key, kind == Kind.Movie ? "search/movie" : "search/tv", new Dictionary<string, object> { ["query"] = query }), kind)
                .Where(c => c.Keys.Contains(query)).ToList();
            return list.FirstOrDefault(c => year is { Length: >= 4 } && c.Year == year[..4]) ?? list.FirstOrDefault();
        }
        catch (Exception) { return null; }
    }

    /// <summary>I remake hanno lo stesso titolo: gli anni devono coincidere (±1) quando ci sono entrambi.</summary>
    public static bool YearsClose(string? a, string? b) =>
        !int.TryParse(a is { Length: >= 4 } ? a[..4] : a, out var x) || !int.TryParse(b, out var y) || Math.Abs(x - y) <= 1;
}
