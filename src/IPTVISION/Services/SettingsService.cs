using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace IPTVISION.Services;

public sealed class AppSettings
{
    public string? Server { get; set; }
    public string? Username { get; set; }
    /// <summary>Password cifrata con DPAPI (leggibile solo dall'utente Windows corrente).</summary>
    public string? ProtectedPassword { get; set; }

    public int Volume { get; set; } = 80;
    public bool Muted { get; set; }
    public int? LastStreamId { get; set; }
    public string? LastCategoryId { get; set; }
    public HashSet<int> Favorites { get; set; } = [];

    public string OutputFormat { get; set; } = "ts";
    public int NetworkCachingMs { get; set; } = 1500;
    public bool Deinterlace { get; set; } = true;
    public bool HardwareDecoding { get; set; } = true;
    public bool AutoPlayLastChannel { get; set; } = true;
    public bool StartInTvMode { get; set; }
    public bool AutoCheckUpdates { get; set; } = true;
    /// <summary>Nasconde le categorie con "XXX" nel nome (canali, film e serie).</summary>
    public bool HideAdult { get; set; }

    /// <summary>Ordinamento scelto per ogni sezione ("Live", "Movies", "Series").</summary>
    public Dictionary<string, string> ListSort { get; set; } = [];
    /// <summary>Sezioni mostrate a griglia invece che a elenco.</summary>
    public HashSet<string> GridViews { get; set; } = [];

    public double? WinLeft { get; set; }
    public double? WinTop { get; set; }
    public double? WinWidth { get; set; }
    public double? WinHeight { get; set; }
    public bool WinMaximized { get; set; }
    public bool PanelVisible { get; set; } = true;

    public bool HasAccount => !string.IsNullOrWhiteSpace(Server) && !string.IsNullOrWhiteSpace(Username) && ProtectedPassword != null;
}

public static class SettingsService
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(AppPaths.SettingsFile))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.SettingsFile)) ?? new AppSettings();
        }
        catch (Exception ex)
        {
            Log.Write("Impostazioni illeggibili, uso i default", ex);
        }
        return new AppSettings();
    }

    public static void Save(AppSettings s)
    {
        try
        {
            AppPaths.WriteAllTextAtomic(AppPaths.SettingsFile, JsonSerializer.Serialize(s, Json));
        }
        catch (Exception ex)
        {
            Log.Write("Salvataggio impostazioni fallito", ex);
        }
    }

    public static string Protect(string plain) =>
        Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), null, DataProtectionScope.CurrentUser));

    public static string? Unprotect(string? cipher)
    {
        if (cipher == null) return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(cipher), null, DataProtectionScope.CurrentUser));
        }
        catch (Exception ex)
        {
            Log.Write("Password non decifrabile", ex);
            return null;
        }
    }
}
