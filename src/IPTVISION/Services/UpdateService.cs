using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace IPTVISION.Services;

public sealed record UpdateInfo(Version Version, string Notes, string DownloadUrl, string FileName, long Size, string PageUrl);

/// <summary>
/// Aggiornamenti dalle release di GitHub: legge l'ultima release pubblicata, scarica il setup
/// e lo avvia in modalità silenziosa. Il setup chiude IPTVISION, lo aggiorna e lo riapre.
/// </summary>
public static class UpdateService
{
    public const string Repository = "carellice/IPTVISION";
    public static string RepositoryUrl => $"https://github.com/{Repository}";

    // IPTVISION_UPDATE_URL permette di provare gli aggiornamenti con un server locale.
    private static string LatestUrl => Environment.GetEnvironmentVariable("IPTVISION_UPDATE_URL") is { Length: > 0 } u
        ? u
        : $"https://api.github.com/repos/{Repository}/releases/latest";

    private static readonly HttpClient Http = CreateClient();

    public static Version CurrentVersion { get; } = ReadCurrentVersion();

    public static string CurrentVersionText => Format(CurrentVersion);

    private static HttpClient CreateClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"IPTVISION/{Format(ReadCurrentVersion())}");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }

    private static Version ReadCurrentVersion()
    {
        var info = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        return TryParse(info, out var v) ? v : Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);
    }

    public static string Format(Version v) => v.Build >= 0 ? $"{v.Major}.{v.Minor}.{v.Build}" : $"{v.Major}.{v.Minor}";

    /// <summary>Accetta "v1.2.3", "1.2.3", "1.2.3+commit".</summary>
    public static bool TryParse(string? text, out Version version)
    {
        version = new Version(0, 0, 0);
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = text.Trim().TrimStart('v', 'V');
        var cut = t.IndexOfAny(['+', '-', ' ']);
        if (cut > 0) t = t[..cut];
        if (!Version.TryParse(t, out var v)) return false;
        version = new Version(v.Major, v.Minor, Math.Max(v.Build, 0));
        return true;
    }

    /// <summary>Ultima release se più recente di quella in uso, altrimenti null.</summary>
    public static async Task<UpdateInfo?> CheckAsync(CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var response = await Http.GetAsync(LatestUrl, timeout.Token).ConfigureAwait(false);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null; // nessuna release pubblicata
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token).ConfigureAwait(false);
        var root = doc.RootElement;

        if (root.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True) return null;
        if (root.TryGetProperty("prerelease", out var pre) && pre.ValueKind == JsonValueKind.True) return null;
        if (!TryParse(root.TryGetProperty("tag_name", out var tag) ? tag.GetString() : null, out var latest)) return null;
        if (latest <= CurrentVersion) return null;

        if (!root.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) return null;
        foreach (var asset in assets.EnumerateArray())
        {
            var name = asset.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                !name.Contains("setup", StringComparison.OrdinalIgnoreCase)) continue;

            var url = asset.TryGetProperty("browser_download_url", out var u) ? u.GetString() : null;
            if (string.IsNullOrEmpty(url)) continue;

            var size = asset.TryGetProperty("size", out var s) && s.TryGetInt64(out var sz) ? sz : 0;
            var notes = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
            var page = root.TryGetProperty("html_url", out var h) ? h.GetString() ?? RepositoryUrl : RepositoryUrl;
            return new UpdateInfo(latest, notes.Trim(), url, name, size, page);
        }
        return null;
    }

    /// <summary>Scarica il setup nella cache locale; progress riceve valori da 0 a 1.</summary>
    public static async Task<string> DownloadAsync(UpdateInfo info, IProgress<double>? progress, CancellationToken ct = default)
    {
        var dir = Path.Combine(AppPaths.Local, "updates");
        if (Directory.Exists(dir))
            foreach (var old in Directory.EnumerateFiles(dir)) { try { File.Delete(old); } catch { } }
        Directory.CreateDirectory(dir);

        var target = Path.Combine(dir, Path.GetFileName(info.FileName));
        var partial = target + ".part";

        using (var response = await Http.GetAsync(info.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false))
        {
            response.EnsureSuccessStatusCode();
            var total = response.Content.Headers.ContentLength ?? info.Size;
            await using var input = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            await using var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true);

            var buffer = new byte[1 << 16];
            long done = 0;
            int read;
            while ((read = await input.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                done += read;
                if (total > 0) progress?.Report(Math.Min(1, (double)done / total));
            }
            if (total > 0 && done != total) throw new IOException("Download incompleto");
        }

        File.Move(partial, target, overwrite: true);
        progress?.Report(1);
        return target;
    }

    /// <summary>
    /// Avvia il setup senza domande: mostra solo l'avanzamento, aspetta che IPTVISION si chiuda
    /// e lo riapre alla fine. Chi chiama deve chiudere IPTVISION subito dopo.
    /// </summary>
    public static void LaunchInstaller(string setupPath)
    {
        var log = Path.Combine(Path.GetDirectoryName(setupPath)!, "setup.log");
        Process.Start(new ProcessStartInfo(setupPath)
        {
            Arguments = $"/SILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /LOG=\"{log}\"",
            UseShellExecute = true,
        });
    }
}
