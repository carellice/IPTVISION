using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using IPTVISION.Models;

namespace IPTVISION.Services;

public sealed class XtreamException(string message, Exception? inner = null) : Exception(message, inner)
{
    /// <summary>True se l'errore riguarda le credenziali/account e non la rete.</summary>
    public bool IsAuthError { get; init; }
}

public sealed record XtreamAccount(string Server, string Username, string Password)
{
    public string Key => AppPaths.Hash(Server.ToLowerInvariant() + "|" + Username);
}

/// <summary>Client per le API "player_api.php" dei pannelli Xtream Codes.</summary>
public sealed class XtreamClient
{
    internal static readonly HttpClient Http = CreateHttp();

    private readonly XtreamAccount _account;

    public XtreamClient(XtreamAccount account) => _account = account;

    public XtreamAccount Account => _account;

    private static HttpClient CreateHttp()
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
        };
        var http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("IPTVISION/1.0");
        return http;
    }

    /// <summary>
    /// Accetta "host:porta", "http://host:porta/" o l'intero link M3U
    /// (get.php?username=..&amp;password=..) e restituisce server/utente/password separati.
    /// </summary>
    public static (string Server, string? Username, string? Password) ParseServerInput(string input)
    {
        var s = input.Trim();
        if (s.Length == 0) return ("", null, null);
        if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            s = "http://" + s;

        if (!Uri.TryCreate(s, UriKind.Absolute, out var uri)) return (s.TrimEnd('/'), null, null);

        string? user = null, pass = null;
        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            var v = Uri.UnescapeDataString(kv[1]);
            if (kv[0].Equals("username", StringComparison.OrdinalIgnoreCase)) user = v;
            else if (kv[0].Equals("password", StringComparison.OrdinalIgnoreCase)) pass = v;
        }

        // Rimuove get.php / player_api.php / xmltv.php dal percorso, tiene eventuali sottocartelle.
        var path = uri.AbsolutePath;
        var last = path.LastIndexOf('/');
        if (last >= 0 && path[(last + 1)..].EndsWith(".php", StringComparison.OrdinalIgnoreCase)) path = path[..last];
        var server = $"{uri.Scheme}://{uri.Authority}{path}".TrimEnd('/');
        return (server, user, pass);
    }

    private string Q(string v) => Uri.EscapeDataString(v);

    private string ApiUrl(string? action, string? extra = null)
    {
        var sb = new StringBuilder($"{_account.Server}/player_api.php?username={Q(_account.Username)}&password={Q(_account.Password)}");
        if (action != null) sb.Append("&action=").Append(action);
        if (extra != null) sb.Append('&').Append(extra);
        return sb.ToString();
    }

    public string XmltvUrl => $"{_account.Server}/xmltv.php?username={Q(_account.Username)}&password={Q(_account.Password)}";

    public string GetLiveUrl(int streamId, string ext) =>
        $"{_account.Server}/live/{Q(_account.Username)}/{Q(_account.Password)}/{streamId}.{ext}";

    public string GetMovieUrl(int streamId, string ext) =>
        $"{_account.Server}/movie/{Q(_account.Username)}/{Q(_account.Password)}/{streamId}.{ext}";

    public string GetEpisodeUrl(string episodeId, string ext) =>
        $"{_account.Server}/series/{Q(_account.Username)}/{Q(_account.Password)}/{Uri.EscapeDataString(episodeId)}.{ext}";

    public async Task<AuthInfo> AuthenticateAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl(null), TimeSpan.FromSeconds(15), ct);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("user_info", out var ui) || ui.ValueKind != JsonValueKind.Object)
            throw new XtreamException("Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.");

        if (GetInt(ui, "auth") != 1)
            throw new XtreamException("Nome utente o password non corretti.") { IsAuthError = true };

        var status = GetString(ui, "status");
        if (status != null && !status.Equals("Active", StringComparison.OrdinalIgnoreCase))
            throw new XtreamException($"Account non attivo (stato: {status}).") { IsAuthError = true };

        DateTimeOffset? exp = null;
        if (long.TryParse(GetString(ui, "exp_date"), out var unix) && unix > 0)
            exp = DateTimeOffset.FromUnixTimeSeconds(unix);

        var formats = new List<string>();
        if (ui.TryGetProperty("allowed_output_formats", out var f) && f.ValueKind == JsonValueKind.Array)
            foreach (var e in f.EnumerateArray())
                if (e.ValueKind == JsonValueKind.String) formats.Add(e.GetString()!);

        return new AuthInfo
        {
            Status = status,
            ExpiresAt = exp,
            MaxConnections = GetInt(ui, "max_connections") ?? 0,
            OutputFormats = formats,
        };
    }

    public Task<List<Category>> GetLiveCategoriesAsync(CancellationToken ct) => GetCategoriesAsync("get_live_categories", ct);
    public Task<List<Category>> GetVodCategoriesAsync(CancellationToken ct) => GetCategoriesAsync("get_vod_categories", ct);
    public Task<List<Category>> GetSeriesCategoriesAsync(CancellationToken ct) => GetCategoriesAsync("get_series_categories", ct);

    private async Task<List<Category>> GetCategoriesAsync(string action, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl(action), TimeSpan.FromSeconds(30), ct);
        var list = new List<Category>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            var id = GetString(e, "category_id");
            var name = GetString(e, "category_name");
            if (id != null) list.Add(new Category(id, name?.Trim() ?? id));
        }
        return list;
    }

    public async Task<List<ChannelData>> GetLiveStreamsAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_live_streams"), TimeSpan.FromSeconds(60), ct);
        var list = new List<ChannelData>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            var id = GetInt(e, "stream_id");
            if (id is null) continue;
            var logo = GetString(e, "stream_icon");
            list.Add(new ChannelData
            {
                StreamId = id.Value,
                Num = GetInt(e, "num") ?? 0,
                Name = (GetString(e, "name") ?? $"Canale {id}").Trim(),
                Logo = string.IsNullOrWhiteSpace(logo) ? null : logo.Trim(),
                CategoryId = GetString(e, "category_id"),
                EpgId = NullIfEmpty(GetString(e, "epg_channel_id")),
            });
        }
        return list;
    }

    public async Task<List<VodData>> GetVodStreamsAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_vod_streams"), TimeSpan.FromSeconds(90), ct);
        var list = new List<VodData>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            var id = GetInt(e, "stream_id");
            if (id is null) continue;
            var name = (GetString(e, "name") ?? $"Film {id}").Trim();
            list.Add(new VodData
            {
                StreamId = id.Value,
                Name = name,
                Poster = NullIfEmpty(GetString(e, "stream_icon")),
                CategoryId = GetString(e, "category_id"),
                Extension = NullIfEmpty(GetString(e, "container_extension")),
                Year = YearOf(GetString(e, "year"), GetString(e, "releasedate"), name),
                Rating = RatingOf(e),
                Added = long.TryParse(GetString(e, "added"), out var added) ? added : 0,
            });
        }
        return list;
    }

    public async Task<List<SeriesData>> GetSeriesAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_series"), TimeSpan.FromSeconds(90), ct);
        var list = new List<SeriesData>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            var id = GetInt(e, "series_id");
            if (id is null) continue;
            var name = (GetString(e, "name") ?? $"Serie {id}").Trim();
            list.Add(new SeriesData
            {
                SeriesId = id.Value,
                Name = name,
                Cover = NullIfEmpty(GetString(e, "cover")),
                CategoryId = GetString(e, "category_id"),
                Year = YearOf(GetString(e, "year"), GetString(e, "releaseDate") ?? GetString(e, "release_date"), name),
                Rating = RatingOf(e),
                Plot = NullIfEmpty(GetString(e, "plot")),
                Genre = NullIfEmpty(GetString(e, "genre")),
            });
        }
        return list;
    }

    public async Task<VodInfo?> GetVodInfoAsync(int streamId, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_vod_info", $"vod_id={streamId}"), TimeSpan.FromSeconds(20), ct);
        if (!doc.RootElement.TryGetProperty("info", out var info) || info.ValueKind != JsonValueKind.Object) return null;
        var secs = GetInt(info, "duration_secs") ?? 0;
        return new VodInfo
        {
            Plot = NullIfEmpty(GetString(info, "plot") ?? GetString(info, "description")),
            Genre = NullIfEmpty(GetString(info, "genre")),
            Year = YearOf(GetString(info, "year"), GetString(info, "releasedate"), ""),
            Duration = secs > 0 ? FormatDuration(secs) : NullIfEmpty(GetString(info, "duration")),
            Director = NullIfEmpty(GetString(info, "director")),
            Cast = NullIfEmpty(GetString(info, "cast") ?? GetString(info, "actors")),
        };
    }

    public async Task<SeriesInfo> GetSeriesInfoAsync(int seriesId, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_series_info", $"series_id={seriesId}"), TimeSpan.FromSeconds(30), ct);
        var root = doc.RootElement;
        var episodes = new List<Episode>();

        if (root.TryGetProperty("episodes", out var eps))
        {
            // Alcuni pannelli restituiscono { "1": [...], "2": [...] }, altri [[...], [...]].
            IEnumerable<JsonElement> groups = eps.ValueKind switch
            {
                JsonValueKind.Object => eps.EnumerateObject().Select(p => p.Value),
                JsonValueKind.Array => eps.EnumerateArray(),
                _ => [],
            };
            foreach (var group in groups)
            {
                if (group.ValueKind != JsonValueKind.Array) continue;
                foreach (var e in group.EnumerateArray())
                {
                    var id = GetString(e, "id");
                    if (string.IsNullOrEmpty(id)) continue;
                    var info = e.TryGetProperty("info", out var i) && i.ValueKind == JsonValueKind.Object ? i : default;
                    var hasInfo = info.ValueKind == JsonValueKind.Object;
                    episodes.Add(new Episode
                    {
                        Id = id,
                        SeriesId = seriesId,
                        Season = GetInt(e, "season") ?? 1,
                        Number = GetInt(e, "episode_num") ?? 0,
                        Title = (GetString(e, "title") ?? "").Trim(),
                        Extension = NullIfEmpty(GetString(e, "container_extension")) ?? "mp4",
                        DurationSecs = hasInfo ? GetInt(info, "duration_secs") ?? 0 : 0,
                        Plot = hasInfo ? NullIfEmpty(GetString(info, "plot")) : null,
                        Image = hasInfo ? NullIfEmpty(GetString(info, "movie_image")) : null,
                    });
                }
            }
        }

        var si = root.TryGetProperty("info", out var inf) && inf.ValueKind == JsonValueKind.Object ? inf : default;
        var has = si.ValueKind == JsonValueKind.Object;
        return new SeriesInfo
        {
            Plot = has ? NullIfEmpty(GetString(si, "plot")) : null,
            Genre = has ? NullIfEmpty(GetString(si, "genre")) : null,
            Year = has ? YearOf(GetString(si, "year"), GetString(si, "releaseDate") ?? GetString(si, "release_date"), "") : null,
            Cast = has ? NullIfEmpty(GetString(si, "cast")) : null,
            Episodes = episodes.OrderBy(x => x.Season).ThenBy(x => x.Number).ToList(),
        };
    }

    private static string FormatDuration(int secs)
    {
        var t = TimeSpan.FromSeconds(secs);
        return t.TotalHours >= 1 ? $"{(int)t.TotalHours} h {t.Minutes:00} min" : $"{t.Minutes} min";
    }

    private static string? YearOf(string? year, string? date, string name)
    {
        if (!string.IsNullOrWhiteSpace(year) && year.Trim().Length >= 4 && int.TryParse(year.Trim()[..4], out var y) && y > 1880) return y.ToString();
        if (!string.IsNullOrWhiteSpace(date) && date.Trim().Length >= 4 && int.TryParse(date.Trim()[..4], out y) && y > 1880) return y.ToString();
        var m = System.Text.RegularExpressions.Regex.Match(name, @"\((19|20)\d{2}\)");
        return m.Success ? m.Value.Trim('(', ')') : null;
    }

    private static double RatingOf(JsonElement e)
    {
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        if (double.TryParse(GetString(e, "rating"), System.Globalization.NumberStyles.Float, inv, out var r) && r > 0) return Math.Min(r, 10);
        if (double.TryParse(GetString(e, "rating_5based"), System.Globalization.NumberStyles.Float, inv, out r) && r > 0) return Math.Min(r * 2, 10);
        return 0;
    }

    /// <summary>EPG breve di un singolo canale: usato quando xmltv.php non copre il canale.</summary>
    public async Task<List<Programme>> GetShortEpgAsync(int streamId, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl("get_short_epg", $"stream_id={streamId}&limit=6"), TimeSpan.FromSeconds(15), ct);
        var list = new List<Programme>();
        if (!doc.RootElement.TryGetProperty("epg_listings", out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in arr.EnumerateArray())
        {
            if (!long.TryParse(GetString(e, "start_timestamp"), out var st) || !long.TryParse(GetString(e, "stop_timestamp"), out var sp)) continue;
            list.Add(new Programme(
                DateTimeOffset.FromUnixTimeSeconds(st),
                DateTimeOffset.FromUnixTimeSeconds(sp),
                DecodeB64(GetString(e, "title")) ?? "",
                DecodeB64(GetString(e, "description"))));
        }
        return list;
    }

    private static async Task<JsonDocument> GetJsonAsync(string url, TimeSpan timeout, CancellationToken ct)
    {
        Exception? last = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);
            try
            {
                using var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                if (resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    throw new XtreamException("Accesso negato dal server (credenziali errate o account scaduto).") { IsAuthError = true };
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
                return await JsonDocument.ParseAsync(stream, cancellationToken: cts.Token);
            }
            catch (XtreamException) { throw; }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or IOException)
            {
                last = ex;
                Log.Write($"Richiesta API fallita (tentativo {attempt + 1})", ex);
                if (attempt < 2) await Task.Delay(500 * (attempt + 1), ct);
            }
        }
        throw new XtreamException(last is JsonException
            ? "Risposta del server non valida."
            : "Impossibile contattare il server. Controlla la connessione.", last);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string? DecodeB64(string? s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        try { return Encoding.UTF8.GetString(Convert.FromBase64String(s)).Trim(); }
        catch { return s; }
    }

    // I pannelli Xtream restituiscono numeri a volte come stringhe, a volte come numeri.
    internal static string? GetString(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            JsonValueKind.True => "1",
            JsonValueKind.False => "0",
            _ => null,
        };
    }

    internal static int? GetInt(JsonElement e, string name)
    {
        var s = GetString(e, name);
        if (s == null) return null;
        if (int.TryParse(s, out var i)) return i;
        if (double.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, out var d)) return (int)d;
        return null;
    }
}
