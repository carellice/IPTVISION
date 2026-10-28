using System.IO;
using System.Text.Json;
using IPTVISION.Models;

namespace IPTVISION.Services;

public sealed class ChannelCache
{
    public DateTimeOffset SavedAt { get; set; }
    public List<Category> Categories { get; set; } = [];
    public List<ChannelData> Channels { get; set; } = [];
}

public sealed class LibraryCache<T>
{
    public DateTimeOffset SavedAt { get; set; }
    public List<Category> Categories { get; set; } = [];
    public List<T> Items { get; set; } = [];
}

/// <summary>Lista canali salvata su disco: all'avvio l'app è subito pronta, anche offline.</summary>
public static class CacheService
{
    private static string FileFor(string accountKey) => Path.Combine(AppPaths.Cache, $"channels_{accountKey}.json");

    public static ChannelCache? Load(string accountKey)
    {
        try
        {
            var f = FileFor(accountKey);
            if (!File.Exists(f)) return null;
            using var s = File.OpenRead(f);
            return JsonSerializer.Deserialize<ChannelCache>(s);
        }
        catch (Exception ex)
        {
            Log.Write("Cache canali illeggibile", ex);
            return null;
        }
    }

    public static void Save(string accountKey, ChannelCache cache)
    {
        try
        {
            AppPaths.WriteAllTextAtomic(FileFor(accountKey), JsonSerializer.Serialize(cache));
        }
        catch (Exception ex)
        {
            Log.Write("Salvataggio cache canali fallito", ex);
        }
    }

    /// <summary>Cache di film ("vod") o serie ("series"), separata dai canali: si carica solo quando serve.</summary>
    public static LibraryCache<T>? LoadLibrary<T>(string kind, string accountKey)
    {
        try
        {
            var f = Path.Combine(AppPaths.Cache, $"{kind}_{accountKey}.json");
            if (!File.Exists(f)) return null;
            using var s = File.OpenRead(f);
            return JsonSerializer.Deserialize<LibraryCache<T>>(s);
        }
        catch (Exception ex)
        {
            Log.Write($"Cache {kind} illeggibile", ex);
            return null;
        }
    }

    public static void SaveLibrary<T>(string kind, string accountKey, LibraryCache<T> cache)
    {
        try
        {
            AppPaths.WriteAllTextAtomic(Path.Combine(AppPaths.Cache, $"{kind}_{accountKey}.json"), JsonSerializer.Serialize(cache));
        }
        catch (Exception ex)
        {
            Log.Write($"Salvataggio cache {kind} fallito", ex);
        }
    }

    public static void Clear()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(AppPaths.Cache)) File.Delete(f);
        }
        catch (Exception ex)
        {
            Log.Write("Pulizia cache fallita", ex);
        }
    }
}
