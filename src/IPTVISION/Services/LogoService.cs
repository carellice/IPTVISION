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

    /// <summary>
    /// Host che non rispondono (bloccati dal provider Internet, spenti): dopo 3 errori di rete di fila
    /// si saltano per 5 minuti, così non tengono occupati i 6 download per 12 secondi l'uno e le
    /// locandine degli altri host arrivano subito.
    /// </summary>
    private readonly ConcurrentDictionary<string, (int Fails, DateTime Until)> _badHosts = new();

    /// <param name="width">Larghezza di decodifica: 112 per loghi e locandine, di più per le immagini grandi di "Film e serie".</param>
    public void Request(string? url, Action<ImageSource> apply, int width = 112)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out _)) return;
        _ = LoadAsync(url, apply, width);
    }

    private async Task LoadAsync(string url, Action<ImageSource> apply, int width)
    {
        var key = width == 112 ? url : $"{width}|{url}";
        var img = await _memory.GetOrAdd(key, _ => Task.Run(() => FetchAsync(url, width)));
        if (img == null)
        {
            _memory.TryRemove(key, out _); // un errore non resta per tutta la sessione: si riprova alla prossima richiesta
            return;
        }
        var d = Application.Current?.Dispatcher;
        if (d == null) return;
        _ = d.BeginInvoke(() => apply(img));
    }

    private async Task<ImageSource?> FetchAsync(string url, int width)
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
            else if (_badHosts.TryGetValue(new Uri(url).Authority, out var bad) && bad.Until > DateTime.UtcNow)
            {
                if (fi.Exists && fi.Length > 0) bytes = await File.ReadAllBytesAsync(file);
            }
            else
            {
                var host = new Uri(url).Authority;
                await _gate.WaitAsync();
                try
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    bytes = await XtreamClient.Http.GetByteArrayAsync(url, cts.Token);
                    await File.WriteAllBytesAsync(file, bytes);
                    _badHosts.TryRemove(host, out _);
                }
                catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException)
                {
                    // un 404 riguarda solo questa immagine; timeout e connessione rifiutata riguardano l'host
                    if (ex is not HttpRequestException { StatusCode: not null })
                    {
                        var fails = _badHosts.AddOrUpdate(host, (1, default), (_, b) => (b.Fails + 1, default)).Fails;
                        if (fails >= 3)
                        {
                            _badHosts[host] = (0, DateTime.UtcNow.AddMinutes(5));
                            Log.Write($"Locandine non raggiungibili da {host}: salto questo host per 5 minuti", ex);
                        }
                    }
                    // rete giù: meglio un logo vecchio che nessun logo
                    if (fi.Exists && fi.Length > 0) bytes = await File.ReadAllBytesAsync(file);
                }
                finally
                {
                    _gate.Release();
                }
            }
            return bytes is { Length: > 0 } ? Decode(bytes, width) : null;
        }
        catch (Exception ex)
        {
            Log.Write($"Logo non caricabile: {url}", ex);
            return null;
        }
    }

    private static ImageSource? Decode(byte[] bytes, int width)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bmp.DecodePixelWidth = width;
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
