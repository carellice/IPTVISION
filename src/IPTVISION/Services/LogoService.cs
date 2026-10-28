using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace IPTVISION.Services;

/// <summary>Scarica i loghi in modo pigro, li salva su disco e li decodifica già ridimensionati.</summary>
public sealed class LogoService
{
    public static LogoService Instance { get; } = new();

    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(14);
    private readonly SemaphoreSlim _gate = new(6);
    private readonly ConcurrentDictionary<string, Task<ImageSource?>> _memory = new();

    public void Request(string? url, Action<ImageSource> apply)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out _)) return;
        _ = LoadAsync(url, apply);
    }

    private async Task LoadAsync(string url, Action<ImageSource> apply)
    {
        var img = await _memory.GetOrAdd(url, u => Task.Run(() => FetchAsync(u)));
        if (img == null) return;
        var d = Application.Current?.Dispatcher;
        if (d == null) return;
        _ = d.BeginInvoke(() => apply(img));
    }

    private async Task<ImageSource?> FetchAsync(string url)
    {
        var file = Path.Combine(AppPaths.Logos, AppPaths.Hash(url) + ".img");
        try
        {
            byte[]? bytes = null;
            var fi = new FileInfo(file);
            if (fi.Exists && fi.Length > 0 && DateTime.UtcNow - fi.LastWriteTimeUtc < MaxAge)
            {
                bytes = await File.ReadAllBytesAsync(file);
            }
            else
            {
                await _gate.WaitAsync();
                try
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    bytes = await XtreamClient.Http.GetByteArrayAsync(url, cts.Token);
                    await File.WriteAllBytesAsync(file, bytes);
                }
                catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException)
                {
                    // rete giù: meglio un logo vecchio che nessun logo
                    if (fi.Exists && fi.Length > 0) bytes = await File.ReadAllBytesAsync(file);
                }
                finally
                {
                    _gate.Release();
                }
            }
            return bytes is { Length: > 0 } ? Decode(bytes) : null;
        }
        catch (Exception ex)
        {
            Log.Write($"Logo non caricabile: {url}", ex);
            return null;
        }
    }

    private static ImageSource? Decode(byte[] bytes)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bmp.DecodePixelWidth = 112;
            bmp.StreamSource = new MemoryStream(bytes);
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch
        {
            return null; // SVG o formati non supportati: resta il fallback con le iniziali
        }
    }
}
