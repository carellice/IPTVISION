using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Xml;
using IPTVISION.Models;

namespace IPTVISION.Services;

/// <summary>
/// Guida TV. Fonte principale: xmltv.php (una sola richiesta per tutti i canali),
/// filtrata ai soli canali dell'account e salvata su disco per 6 ore.
/// Ripiego per il canale in onda: get_short_epg.
/// </summary>
public sealed class EpgService
{
    private static readonly TimeSpan CacheAge = TimeSpan.FromHours(6);

    private Dictionary<string, List<Programme>> _byEpgId = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, (DateTimeOffset At, List<Programme> List)> _short = [];

    public bool HasData => _byEpgId.Count > 0;

    private sealed class EpgCacheFile
    {
        public DateTimeOffset SavedAt { get; set; }
        public Dictionary<string, List<Programme>> Data { get; set; } = [];
    }

    public async Task LoadAsync(XtreamClient client, IReadOnlyCollection<string> wantedIds, bool force, CancellationToken ct)
    {
        var file = Path.Combine(AppPaths.Cache, $"epg_{client.Account.Key}.json");

        if (!force && File.Exists(file))
        {
            try
            {
                var cached = await Task.Run(() =>
                {
                    using var s = File.OpenRead(file);
                    return JsonSerializer.Deserialize<EpgCacheFile>(s);
                }, ct);
                if (cached != null)
                {
                    _byEpgId = new Dictionary<string, List<Programme>>(cached.Data, StringComparer.OrdinalIgnoreCase);
                    if (DateTimeOffset.Now - cached.SavedAt < CacheAge) return;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Log.Write("Cache EPG illeggibile", ex);
            }
        }

        var wanted = new HashSet<string>(wantedIds, StringComparer.OrdinalIgnoreCase);
        if (wanted.Count == 0) return;

        try
        {
            var data = await Task.Run(() => DownloadAndParseAsync(client.XmltvUrl, wanted, ct), ct);
            if (data.Count == 0) return;
            _byEpgId = data;
            var json = JsonSerializer.Serialize(new EpgCacheFile { SavedAt = DateTimeOffset.Now, Data = data });
            AppPaths.WriteAllTextAtomic(file, json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            Log.Write("Download EPG fallito", ex);
        }
    }

    private static async Task<Dictionary<string, List<Programme>>> DownloadAndParseAsync(string url, HashSet<string> wanted, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromMinutes(3));

        using var resp = await XtreamClient.Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        resp.EnsureSuccessStatusCode();
        await using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);

        var from = DateTimeOffset.Now.AddHours(-3);
        var to = DateTimeOffset.Now.AddHours(36);
        var result = new Dictionary<string, List<Programme>>(StringComparer.OrdinalIgnoreCase);

        var settings = new XmlReaderSettings
        {
            Async = true,
            DtdProcessing = DtdProcessing.Ignore,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreWhitespace = true,
            CheckCharacters = false,
        };
        using var reader = XmlReader.Create(stream, settings);

        while (await reader.ReadAsync())
        {
            cts.Token.ThrowIfCancellationRequested();
            if (reader.NodeType != XmlNodeType.Element || reader.Name != "programme") continue;

            var channel = reader.GetAttribute("channel");
            if (channel == null || !wanted.Contains(channel)) { await reader.SkipAsync(); continue; }

            var start = ParseXmltvTime(reader.GetAttribute("start"));
            var stop = ParseXmltvTime(reader.GetAttribute("stop"));
            if (start == null || stop == null || stop < from || start > to) { await reader.SkipAsync(); continue; }

            string? title = null, desc = null;
            using (var sub = reader.ReadSubtree())
            {
                await sub.ReadAsync();
                while (await sub.ReadAsync())
                {
                    if (sub.NodeType != XmlNodeType.Element) continue;
                    if (sub.Name == "title" && title == null) title = (await sub.ReadElementContentAsStringAsync()).Trim();
                    else if (sub.Name == "desc" && desc == null) desc = (await sub.ReadElementContentAsStringAsync()).Trim();
                }
            }

            if (!result.TryGetValue(channel, out var list)) result[channel] = list = [];
            list.Add(new Programme(start.Value, stop.Value, title ?? "", desc));
        }

        foreach (var list in result.Values) list.Sort((a, b) => a.Start.CompareTo(b.Start));
        return result;
    }

    /// <summary>Formato XMLTV: "20261028203000 +0100".</summary>
    internal static DateTimeOffset? ParseXmltvTime(string? s)
    {
        if (string.IsNullOrWhiteSpace(s) || s.Length < 14) return null;
        if (!DateTime.TryParseExact(s[..14], "yyyyMMddHHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)) return null;
        var offset = TimeSpan.Zero;
        var rest = s[14..].Trim();
        if (rest.Length >= 5 && (rest[0] == '+' || rest[0] == '-')
            && int.TryParse(rest.AsSpan(1, 2), out var hh) && int.TryParse(rest.AsSpan(3, 2), out var mm))
        {
            offset = new TimeSpan(hh, mm, 0);
            if (rest[0] == '-') offset = -offset;
        }
        return new DateTimeOffset(dt, offset);
    }

    public (Programme? Now, Programme? Next) GetNowNext(Channel ch, DateTimeOffset at)
    {
        var list = GetList(ch);
        if (list == null) return (null, null);
        for (var i = 0; i < list.Count; i++)
        {
            var p = list[i];
            if (p.Start <= at && p.Stop > at) return (p, i + 1 < list.Count ? list[i + 1] : null);
            if (p.Start > at) return (null, p);
        }
        return (null, null);
    }

    private List<Programme>? GetList(Channel ch)
    {
        if (ch.EpgId != null && _byEpgId.TryGetValue(ch.EpgId, out var list) && list.Count > 0) return list;
        return _short.TryGetValue(ch.StreamId, out var s) ? s.List : null;
    }

    /// <summary>Se xmltv non copre il canale, chiede l'EPG breve (al massimo ogni 20 minuti).</summary>
    public async Task<bool> EnsureShortAsync(XtreamClient client, Channel ch, CancellationToken ct)
    {
        var now = DateTimeOffset.Now;
        var (cur, _) = GetNowNext(ch, now);
        if (cur != null) return false;
        if (_short.TryGetValue(ch.StreamId, out var s) && now - s.At < TimeSpan.FromMinutes(20)) return false;
        try
        {
            var list = await client.GetShortEpgAsync(ch.StreamId, ct);
            list.Sort((a, b) => a.Start.CompareTo(b.Start));
            _short[ch.StreamId] = (now, list);
            return list.Count > 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _short[ch.StreamId] = (now, []);
            Log.Write("EPG breve non disponibile", ex);
            return false;
        }
    }
}
