using System.Collections.ObjectModel;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;

namespace IPTVISION.Services;

public enum DownloadState { Queued, Running, Done, Failed }

/// <summary>Un film o un episodio scaricato (o in coda) per guardarlo senza connessione.</summary>
public sealed partial class DownloadItem : ObservableObject
{
    /// <summary>Stessa chiave delle posizioni: "m:{id}" film, "e:{id}" episodi.</summary>
    public required string Key { get; init; }
    public required string Title { get; init; }
    public string? Image { get; init; }
    public required string Url { get; init; }
    public required string FileName { get; init; }
    public int? MovieId { get; init; }
    public string? EpisodeId { get; init; }
    public int? SeriesId { get; init; }
    public string? SeriesName { get; init; }
    public int Season { get; init; }
    public int Number { get; init; }
    public string? EpisodeTitle { get; init; }
    public string Extension { get; init; } = "mp4";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusText), nameof(IsDone), nameof(IsRunning), nameof(IsFailed))]
    private DownloadState _state;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Progress), nameof(StatusText))]
    private long _bytes;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Progress), nameof(StatusText))]
    private long _total;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusText))]
    private string? _error;

    [JsonIgnore] public bool IsEpisode => EpisodeId != null;
    [JsonIgnore] public bool IsDone => State == DownloadState.Done;
    [JsonIgnore] public bool IsRunning => State == DownloadState.Running;
    [JsonIgnore] public bool IsFailed => State == DownloadState.Failed;
    [JsonIgnore] public double Progress => Total > 0 ? Math.Clamp((double)Bytes / Total, 0, 1) : 0;
    [JsonIgnore] public string DisplayTitle => SeriesName ?? Title;
    [JsonIgnore] public string? Subtitle => IsEpisode ? $"S{Season} E{Number} · {EpisodeTitle}" : null;

    [JsonIgnore]
    public string StatusText => State switch
    {
        DownloadState.Done => DownloadService.FormatBytes(Total),
        DownloadState.Running => Total > 0 ? $"{Progress:P0} · {DownloadService.FormatBytes(Bytes)} di {DownloadService.FormatBytes(Total)}" : "Avvio…",
        DownloadState.Queued => "In coda",
        _ => (Error ?? "Non riuscito") + " · clic per riprovare",
    };
}

/// <summary>
/// Download di film ed episodi nella cartella Video\IPTVISION. Uno alla volta, perché molti servizi IPTV
/// accettano una sola connessione per account: gli altri aspettano in coda. Se la connessione cade il
/// download riprende da dove era arrivato; si riprende anche alla riapertura dell'app.
/// </summary>
public sealed class DownloadService
{
    private static readonly HttpClient Http = CreateHttp();
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private readonly string _file = Path.Combine(AppPaths.Roaming, "downloads.json");
    private CancellationTokenSource? _current;
    private DownloadItem? _running;
    private bool _pumping;

    public ObservableCollection<DownloadItem> Items { get; } = [];
    // Con un profilo di prova (IPTVISION_PROFILE) anche i video restano lì dentro.
    public string Folder { get; } = AppPaths.Profile != null ? Path.Combine(AppPaths.Profile, "video")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "IPTVISION");

    /// <summary>Qualcosa è cambiato (stato, aggiunte, rimozioni): l'interfaccia aggiorna i riepiloghi.</summary>
    public event Action? Changed;

    public DownloadService()
    {
        try
        {
            if (File.Exists(_file))
                foreach (var it in JsonSerializer.Deserialize<List<DownloadItem>>(File.ReadAllText(_file), JsonOptions) ?? [])
                {
                    // Interrotto alla chiusura dell'app: torna in coda e riparte.
                    if (it.State == DownloadState.Running) it.State = DownloadState.Queued;
                    if (it.State == DownloadState.Done && !File.Exists(PathOf(it))) continue; // cancellato a mano
                    Items.Add(it);
                }
        }
        catch (Exception ex)
        {
            Log.Write("Elenco download illeggibile", ex);
        }
    }

    public DownloadItem? Get(string key) => Items.FirstOrDefault(i => i.Key == key);

    /// <summary>Il file scaricato, se è completo e c'è ancora.</summary>
    public string? LocalFile(string key) => Get(key) is { IsDone: true } it && File.Exists(PathOf(it)) ? PathOf(it) : null;

    public string PathOf(DownloadItem it) => Path.Combine(Folder, it.FileName);

    public long UsedBytes => Items.Where(i => i.IsDone).Sum(i => i.Total);

    public long FreeBytes
    {
        get
        {
            try { return new DriveInfo(Path.GetPathRoot(Folder)!).AvailableFreeSpace; }
            catch { return 0; }
        }
    }

    public void Add(DownloadItem item)
    {
        if (Get(item.Key) != null) return;
        Items.Add(item);
        Save();
        _ = PumpAsync();
    }

    public void Retry(DownloadItem item)
    {
        if (item.State != DownloadState.Failed) return;
        item.State = DownloadState.Queued;
        item.Error = null;
        Save();
        _ = PumpAsync();
    }

    public void Remove(DownloadItem item)
    {
        if (_running == item) _current?.Cancel();
        Items.Remove(item);
        TryDelete(PathOf(item));
        TryDelete(PathOf(item) + ".part");
        Save();
        _ = PumpAsync();
    }

    /// <summary>Avvia i download in coda, uno dopo l'altro.</summary>
    public async Task PumpAsync()
    {
        if (_pumping) return;
        _pumping = true;
        try
        {
            while (Items.FirstOrDefault(i => i.State == DownloadState.Queued) is { } next)
                await RunAsync(next);
        }
        finally
        {
            _pumping = false;
        }
    }

    private async Task RunAsync(DownloadItem item)
    {
        var cts = _current = new CancellationTokenSource();
        _running = item;
        item.State = DownloadState.Running;
        item.Error = null;
        Save();
        var target = PathOf(item);
        var part = target + ".part";
        try
        {
            Directory.CreateDirectory(Folder);
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    await DownloadOnceAsync(item, part, cts.Token);
                    break;
                }
                catch (Exception ex) when (IsNetworkError(ex) && !cts.IsCancellationRequested && attempt < 5)
                {
                    // Connessione caduta: si riprende dal punto in cui era arrivato.
                    Log.Write($"Download interrotto ({item.Title}), tentativo {attempt}", ex);
                    await Task.Delay(TimeSpan.FromSeconds(3 * attempt), cts.Token);
                }
            }
            File.Move(part, target, overwrite: true);
            item.Total = Math.Max(item.Total, new FileInfo(target).Length);
            item.Bytes = item.Total;
            item.State = DownloadState.Done;
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            // Annullato dall'utente: Remove ha già tolto l'elemento, il file parziale si cancella ora che è chiuso.
            TryDelete(part);
        }
        catch (Exception ex)
        {
            Log.Write($"Download non riuscito ({item.Title})", ex);
            item.State = DownloadState.Failed;
            item.Error = ex switch
            {
                IOException io when io.HResult == unchecked((int)0x80070070) => "Spazio su disco esaurito",
                HttpRequestException { StatusCode: { } code } => $"Il server ha risposto {(int)code}",
                HttpRequestException => "Connessione non riuscita",
                _ => "Download non riuscito",
            };
        }
        finally
        {
            _running = null;
            _current = null;
            Save();
        }
    }

    /// <summary>Errori per cui vale la pena riprovare: rete caduta, non risposte del server né disco pieno.</summary>
    private static bool IsNetworkError(Exception ex) => ex switch
    {
        HttpRequestException h => h.StatusCode == null,
        IOException io => io.HResult != unchecked((int)0x80070070),
        _ => false,
    };

    // ConfigureAwait(false): il ciclo di copia gira fuori dal thread dell'interfaccia.
    private static async Task DownloadOnceAsync(DownloadItem item, string part, CancellationToken ct)
    {
        var have = File.Exists(part) ? new FileInfo(part).Length : 0;
        using var req = new HttpRequestMessage(HttpMethod.Get, item.Url);
        if (have > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(have, null);
        using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (resp.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable && have > 0) return; // era già completo
        resp.EnsureSuccessStatusCode();
        var resumed = resp.StatusCode == HttpStatusCode.PartialContent;
        if (!resumed) have = 0; // il server non riprende: si ricomincia
        var length = resp.Content.Headers.ContentLength;
        var total = length is > 0 ? have + length.Value : 0;

        await using var input = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var output = new FileStream(part, resumed ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16, true);
        var buffer = new byte[1 << 16];
        var done = have;
        var lastUi = DateTime.MinValue;
        UpdateUi(item, done, total);
        int n;
        while ((n = await input.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
        {
            await output.WriteAsync(buffer.AsMemory(0, n), ct).ConfigureAwait(false);
            done += n;
            if (DateTime.UtcNow - lastUi > TimeSpan.FromMilliseconds(400))
            {
                lastUi = DateTime.UtcNow;
                UpdateUi(item, done, total);
            }
        }
        if (total > 0 && done < total) throw new IOException("Download incompleto");
        UpdateUi(item, done, Math.Max(total, done));
    }

    private static void UpdateUi(DownloadItem item, long bytes, long total) =>
        Application.Current?.Dispatcher.BeginInvoke(() => { item.Bytes = bytes; item.Total = total; });

    private void Save()
    {
        try
        {
            AppPaths.WriteAllTextAtomic(_file, JsonSerializer.Serialize(Items.ToList(), JsonOptions));
        }
        catch (Exception ex)
        {
            Log.Write("Salvataggio download non riuscito", ex);
        }
        Changed?.Invoke();
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) { Log.Write("File scaricato non eliminato", ex); }
    }

    private static HttpClient CreateHttp()
    {
        var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true, ConnectTimeout = TimeSpan.FromSeconds(15) })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("IPTVISION/1.0");
        return http;
    }

    /// <summary>Nome del file: titolo leggibile più la chiave, così due versioni dello stesso film non si sovrascrivono.</summary>
    public static string FileNameFor(string title, string key, string ext)
    {
        var bad = Path.GetInvalidFileNameChars();
        var safe = new string(title.Where(c => !bad.Contains(c)).ToArray()).Trim();
        if (safe.Length > 80) safe = safe[..80].Trim();
        if (safe.Length == 0) safe = "video";
        return $"{safe} [{key.Replace(':', '-')}].{ext}";
    }

    public static string FormatBytes(long b) => b switch
    {
        >= 1L << 30 => $"{b / (double)(1L << 30):0.0} GB",
        >= 1L << 20 => $"{b / (double)(1L << 20):0} MB",
        _ => $"{b / 1024.0:0} KB",
    };
}
