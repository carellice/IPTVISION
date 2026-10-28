using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace IPTVISION.Services;

public static class AppPaths
{
    /// <summary>Cartella dati alternativa (variabile IPTVISION_PROFILE), utile per provare senza toccare i dati veri.</summary>
    public static string? Profile { get; } = Environment.GetEnvironmentVariable("IPTVISION_PROFILE") is { Length: > 0 } p ? Path.GetFullPath(p) : null;

    public static string Roaming { get; } = Ensure(Profile ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "IPTVISION"));
    public static string Local { get; } = Ensure(Profile != null ? Path.Combine(Profile, "local") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IPTVISION"));
    public static string Cache { get; } = Ensure(Path.Combine(Local, "cache"));
    public static string Logos { get; } = Ensure(Path.Combine(Local, "logos"));
    public static string SettingsFile => Path.Combine(Roaming, "settings.json");
    public static string LogFile => Path.Combine(Local, "iptvision.log");

    public static string Hash(string s) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(s)))[..16].ToLowerInvariant();

    /// <summary>Scrittura atomica: un crash a metà non corrompe mai il file esistente.</summary>
    public static void WriteAllTextAtomic(string path, string content)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, content, Encoding.UTF8);
        File.Move(tmp, path, overwrite: true);
    }

    private static string Ensure(string dir)
    {
        Directory.CreateDirectory(dir);
        return dir;
    }
}

public static class Log
{
    private static readonly object Gate = new();

    public static void Write(string message, Exception? ex = null)
    {
        try
        {
            lock (Gate)
            {
                var fi = new FileInfo(AppPaths.LogFile);
                if (fi.Exists && fi.Length > 1_000_000) fi.Delete();
                File.AppendAllText(AppPaths.LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{(ex != null ? " | " + ex : "")}{Environment.NewLine}");
            }
        }
        catch
        {
            // il log non deve mai far cadere l'app
        }
    }
}
