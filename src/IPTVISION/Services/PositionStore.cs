using System.IO;
using System.Text.Json;

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
        return false;
    }

    public void MarkWatched(string key)
    {
        _data.Positions.Remove(key);
        _dirty |= _data.Watched.Add(key);
    }

    public void SetLastEpisode(int seriesId, string episodeId)
    {
        _data.LastEpisode[seriesId] = new LastEpisodeEntry(episodeId, DateTimeOffset.Now);
        _dirty = true;
    }

    public LastEpisodeEntry? GetLastEpisode(int seriesId) => _data.LastEpisode.GetValueOrDefault(seriesId);

    /// <summary>Toglie un film da "Continua a guardare": dimentica il punto raggiunto.</summary>
    public void ForgetPosition(string key) => _dirty |= _data.Positions.Remove(key);

    /// <summary>Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti.</summary>
    public void ForgetSeries(int seriesId) => _dirty |= _data.LastEpisode.Remove(seriesId);

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
