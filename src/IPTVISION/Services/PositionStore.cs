using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace IPTVISION.Services;

/// <summary>
/// Ricorda dove si è arrivati in film ed episodi, quali sono stati visti
/// e l'ultimo episodio aperto di ogni serie. Chiavi: "m:{id}" film, "e:{id}" episodi, serie per id.
/// </summary>
public sealed class PositionStore
{
    private const int MaxEntries = 600;
    private static readonly TimeSpan SaveEvery = TimeSpan.FromSeconds(15);

    public sealed record Entry(long PositionMs, long DurationMs, DateTimeOffset UpdatedAt);
    public sealed record LastEpisodeEntry(string EpisodeId, DateTimeOffset UpdatedAt);

    private sealed class FileModel
    {
        public Dictionary<string, Entry> Positions { get; set; } = [];
        public HashSet<string> Watched { get; set; } = [];
        public Dictionary<int, LastEpisodeEntry> LastEpisode { get; set; } = [];
    }

    /// <summary>Ogni modifica, nel formato delle operazioni del server di casa (POST /api/ops).</summary>
    public event Action<JsonObject>? Changed;

    private readonly string _file;
    private FileModel _data;
    private bool _dirty;
    private DateTime _lastSave = DateTime.MinValue;

    private PositionStore(string file, FileModel data)
    {
        _file = file;
        _data = data;
    }

    public static PositionStore Load()
    {
        var file = Path.Combine(AppPaths.Roaming, "positions.json");
        try
        {
            if (File.Exists(file))
                return new PositionStore(file, JsonSerializer.Deserialize<FileModel>(File.ReadAllText(file)) ?? new FileModel());
        }
        catch (Exception ex)
        {
            Log.Write("Posizioni di ripresa illeggibili", ex);
        }
        return new PositionStore(file, new FileModel());
    }

    /// <summary>Da dove riprendere (0 = dall'inizio). Non riprende i primi 30 s né gli ultimi 90 s.</summary>
    public long GetResumeMs(string key) =>
        _data.Positions.TryGetValue(key, out var e) && e.PositionMs > 30_000 && (e.DurationMs <= 0 || e.DurationMs - e.PositionMs > 90_000)
            ? e.PositionMs
            : 0;

    public double GetProgress(string key)
    {
        if (_data.Watched.Contains(key)) return 1;
        return _data.Positions.TryGetValue(key, out var e) && e.DurationMs > 0 ? Math.Clamp((double)e.PositionMs / e.DurationMs, 0, 0.99) : 0;
    }

    public bool IsWatched(string key) => _data.Watched.Contains(key);

    public DateTimeOffset? GetUpdatedAt(string key) => _data.Positions.TryGetValue(key, out var e) ? e.UpdatedAt : null;

    /// <summary>Aggiorna la posizione. Restituisce true se il contenuto risulta finito.</summary>
    public bool Update(string key, long positionMs, long durationMs)
    {
        if (durationMs <= 0 || positionMs <= 0) return false;
        if (positionMs >= durationMs * 0.95 || durationMs - positionMs < 90_000)
        {
            MarkWatched(key);
            return true;
        }
        if (positionMs < 30_000) return false;
        _data.Positions[key] = new Entry(positionMs, durationMs, DateTimeOffset.Now);
        _data.Watched.Remove(key);
        _dirty = true;
        Changed?.Invoke(new JsonObject { ["op"] = "position", ["key"] = key, ["p"] = positionMs, ["d"] = durationMs });
        return false;
    }

    public void MarkWatched(string key)
    {
        _data.Positions.Remove(key);
        _dirty |= _data.Watched.Add(key);
        Changed?.Invoke(new JsonObject { ["op"] = "watched", ["key"] = key });
    }

    public void SetLastEpisode(int seriesId, string episodeId)
    {
        _data.LastEpisode[seriesId] = new LastEpisodeEntry(episodeId, DateTimeOffset.Now);
        _dirty = true;
        Changed?.Invoke(new JsonObject { ["op"] = "lastEpisode", ["seriesId"] = seriesId, ["id"] = episodeId });
    }

    public LastEpisodeEntry? GetLastEpisode(int seriesId) => _data.LastEpisode.GetValueOrDefault(seriesId);

    /// <summary>Toglie un film da "Continua a guardare": dimentica il punto raggiunto.</summary>
    public void ForgetPosition(string key)
    {
        _dirty |= _data.Positions.Remove(key);
        Changed?.Invoke(new JsonObject { ["op"] = "forgetPosition", ["key"] = key });
    }

    /// <summary>Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti.</summary>
    public void ForgetSeries(int seriesId)
    {
        _dirty |= _data.LastEpisode.Remove(seriesId);
        Changed?.Invoke(new JsonObject { ["op"] = "forgetSeries", ["seriesId"] = seriesId });
    }

    /// <summary>Tutto il contenuto nel formato di positions.json delle app Android e TV (e del server di casa).</summary>
    public JsonObject ToServerJson()
    {
        var positions = new JsonObject();
        foreach (var (k, e) in _data.Positions)
            positions[k] = new JsonObject { ["p"] = e.PositionMs, ["d"] = e.DurationMs, ["u"] = e.UpdatedAt.ToUnixTimeMilliseconds() };
        var last = new JsonObject();
        foreach (var (k, e) in _data.LastEpisode)
            last[k.ToString()] = new JsonObject { ["id"] = e.EpisodeId, ["u"] = e.UpdatedAt.ToUnixTimeMilliseconds() };
        return new JsonObject
        {
            ["positions"] = positions,
            ["watched"] = new JsonArray(_data.Watched.Select(w => (JsonNode)w).ToArray()),
            ["lastEpisode"] = last,
        };
    }

    /// <summary>Sostituisce tutto con i dati del server di casa (stesso formato di <see cref="ToServerJson"/>).</summary>
    public void ReplaceWith(JsonObject o)
    {
        var data = new FileModel();
        if (o["positions"] is JsonObject ps)
            foreach (var (k, v) in ps)
                if (v is JsonObject e)
                    data.Positions[k] = new Entry((long?)e["p"] ?? 0, (long?)e["d"] ?? 0, DateTimeOffset.FromUnixTimeMilliseconds((long?)e["u"] ?? 0));
        if (o["watched"] is JsonArray w)
            foreach (var k in w) if ((string?)k is { } key) data.Watched.Add(key);
        if (o["lastEpisode"] is JsonObject le)
            foreach (var (k, v) in le)
                if (int.TryParse(k, out var id) && v is JsonObject e && (string?)e["id"] is { } ep)
                    data.LastEpisode[id] = new LastEpisodeEntry(ep, DateTimeOffset.FromUnixTimeMilliseconds((long?)e["u"] ?? 0));
        _data = data;
        _dirty = true;
        Save(force: true);
    }

    public void Save(bool force = false)
    {
        if (!_dirty) return;
        if (!force && DateTime.UtcNow - _lastSave < SaveEvery) return;
        try
        {
            if (_data.Positions.Count > MaxEntries)
                foreach (var old in _data.Positions.OrderBy(p => p.Value.UpdatedAt).Take(_data.Positions.Count - MaxEntries).Select(p => p.Key).ToList())
                    _data.Positions.Remove(old);
            AppPaths.WriteAllTextAtomic(_file, JsonSerializer.Serialize(_data));
            _dirty = false;
            _lastSave = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            Log.Write("Salvataggio posizioni fallito", ex);
        }
    }
}
