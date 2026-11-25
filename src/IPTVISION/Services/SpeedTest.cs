using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;

namespace IPTVISION.Services;

/// <summary>Speedtest veloce prima di un canale in diretta, per scegliere la qualità che la connessione regge.</summary>
public static class SpeedTest
{
    /// <summary>Senza server di casa si misura Internet di questo PC.</summary>
    private const string InternetUrl = "https://speed.cloudflare.com/__down?bytes=50000000";
    private static readonly TimeSpan TestTime = TimeSpan.FromMilliseconds(1500);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(6) };

    /// <summary>Mb/s di un download, contati dal primo byte e per al massimo 1,5 secondi; null se non riesce.</summary>
    public static async Task<double?> DownloadAsync(string url, string? token = null)
    {
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(6));
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (token != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, stop.Token);
            if (!resp.IsSuccessStatusCode) return null;
            await using var input = await resp.Content.ReadAsStreamAsync(stop.Token);
            var buf = new byte[64 * 1024];
            if (await input.ReadAsync(buf, stop.Token) <= 0) return null;
            var clock = Stopwatch.StartNew();
            long bytes = 0;
            while (clock.Elapsed < TestTime)
            {
                var n = await input.ReadAsync(buf, stop.Token);
                if (n <= 0) break;
                bytes += n;
            }
            var seconds = clock.Elapsed.TotalSeconds;
            return seconds > 0.05 ? bytes * 8 / seconds / 1e6 : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>La velocità che avrà un canale: con il server di casa la più lenta tra Internet del server e la strada dal server al PC.</summary>
    public static async Task<double?> LiveAsync(string? homeServer, string? token)
    {
        if (homeServer == null || token == null) return await DownloadAsync(InternetUrl);
        var server = ServerSpeedAsync(homeServer, token);
        var here = DownloadAsync(homeServer + "/api/speedtest/down?bytes=50000000", token);
        var known = new[] { await server, await here }.Where(v => v != null).Select(v => v!.Value).ToList();
        return known.Count > 0 ? known.Min() : null;
    }

    private static async Task<double?> ServerSpeedAsync(string url, string token)
    {
        try { return await ServerApi.SpeedAsync(url, token); }
        catch (Exception) { return null; }
    }
}
