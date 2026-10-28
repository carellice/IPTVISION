using System.Runtime.InteropServices;
using System.Windows.Threading;
using LibVLCSharp.Shared;

namespace IPTVISION.Services;

public enum PlaybackState { Idle, Connecting, Buffering, Playing, Paused, Reconnecting }

/// <summary>
/// Motore di riproduzione (libVLC) con riconnessione automatica.
/// Un watchdog controlla che il tempo del flusso avanzi davvero: se il flusso
/// si blocca senza errori (caso tipico delle IPTV) il canale viene riaperto.
/// </summary>
public sealed class PlayerService : IDisposable
{
    private static readonly TimeSpan StallWhilePlaying = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan StallWhileOpening = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan VodStallWhilePlaying = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan VodStallWhileOpening = TimeSpan.FromSeconds(35);

    private readonly Dispatcher _ui;
    private readonly DispatcherTimer _watchdog;
    private readonly DispatcherTimer _retryTimer;
    private readonly SemaphoreSlim _vlcGate = new(1, 1);

    private string? _url;
    private bool _live = true;
    private long _resumeMs;
    private volatile int _generation;
    private long _lastTime = -1;
    private DateTime _lastProgressUtc;
    private DateTime _startedUtc;
    private int _volume = 80;
    private bool _muted;

    public PlayerService(AppSettings settings)
    {
        _ui = Dispatcher.CurrentDispatcher;
        Core.Initialize();

        var args = new List<string> { "--no-osd", "--no-video-title-show", "--no-snapshot-preview" };
        if (NeedsPluginCache()) args.Add("--reset-plugins-cache");
        if (settings.Deinterlace)
        {
            // Il digitale terrestre è quasi tutto interlacciato (576i/1080i): "auto" deinterlaccia solo quando serve.
            args.Add("--deinterlace=-1");
            args.Add("--deinterlace-mode=yadif");
        }
        LibVLC = new LibVLC(args.ToArray());

        Player = new MediaPlayer(LibVLC)
        {
            EnableHardwareDecoding = settings.HardwareDecoding,
            EnableKeyInput = false,
            EnableMouseInput = false,
        };
        NetworkCachingMs = settings.NetworkCachingMs;

        Player.Playing += (_, _) => Post(OnPlaying);
        Player.Buffering += (_, e) => { var c = e.Cache; Post(() => OnBuffering(c)); };
        Player.EncounteredError += (_, _) => Post(() => OnFailure("errore di riproduzione"));
        Player.EndReached += (_, _) => Post(OnEndReached);
        Player.Paused += (_, _) => Post(() => { if (_url != null) SetState(PlaybackState.Paused); });
        Player.ESAdded += (_, _) => Post(() => TracksChanged?.Invoke());

        _watchdog = new DispatcherTimer(DispatcherPriority.Background, _ui) { Interval = TimeSpan.FromSeconds(1) };
        _watchdog.Tick += (_, _) => Watchdog();
        _watchdog.Start();

        _retryTimer = new DispatcherTimer(DispatcherPriority.Normal, _ui);
        _retryTimer.Tick += (_, _) =>
        {
            _retryTimer.Stop();
            if (_url != null) Start();
        };
    }

    /// <summary>
    /// Senza plugins.dat libVLC carica tutti i ~320 plugin a ogni avvio (secondi persi).
    /// Al primo avvio lo generiamo, se la cartella è scrivibile; dopo l'avvio è immediato.
    /// </summary>
    private static bool NeedsPluginCache()
    {
        try
        {
            var dir = System.IO.Path.Combine(AppContext.BaseDirectory, "libvlc", "win-x64", "plugins");
            if (!System.IO.Directory.Exists(dir) || System.IO.File.Exists(System.IO.Path.Combine(dir, "plugins.dat"))) return false;
            var probe = System.IO.Path.Combine(dir, ".write-test");
            System.IO.File.WriteAllText(probe, "");
            System.IO.File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public LibVLC LibVLC { get; }
    public MediaPlayer Player { get; }
    public PlaybackState State { get; private set; } = PlaybackState.Idle;
    public float BufferPercent { get; private set; }
    public int Attempt { get; private set; }
    public int NetworkCachingMs { get; set; }
    public bool IsActive => _url != null;
    public bool IsLive => _live;

    /// <summary>Posizione corrente in ms (film/episodi).</summary>
    public long Time { get { try { return Math.Max(0, Player.Time); } catch { return 0; } } }

    /// <summary>Durata in ms, 0 se sconosciuta.</summary>
    public long Length { get { try { return Math.Max(0, Player.Length); } catch { return 0; } } }

    /// <summary>Un film o un episodio è arrivato alla fine (thread UI).</summary>
    public event Action? Ended;

    /// <summary>Un film o un episodio non si apre nonostante i tentativi (thread UI).</summary>
    public event Action? Failed;

    /// <summary>Sempre sul thread UI.</summary>
    public event Action? StateChanged;
    public event Action? TracksChanged;

    public int Volume
    {
        get => _volume;
        set
        {
            _volume = Math.Clamp(value, 0, 125);
            try { Player.Volume = _volume; } catch { }
        }
    }

    public bool Muted
    {
        get => _muted;
        set
        {
            _muted = value;
            try { Player.Mute = value; } catch { }
        }
    }

    /// <summary>live=false per film/episodi: la fine del file non è un errore e si può riprendere da startMs.</summary>
    public void Play(string url, bool live = true, long startMs = 0)
    {
        _url = url;
        _live = live;
        _resumeMs = live ? 0 : Math.Max(0, startMs);
        Attempt = 0;
        _retryTimer.Stop();
        Start();
    }

    public void Stop()
    {
        _url = null;
        _generation++;
        _retryTimer.Stop();
        SetState(PlaybackState.Idle);
        _ = RunVlc(() => Player.Stop());
    }

    /// <summary>Riapre il canale corrente da zero (tasto "Ricarica").</summary>
    public void Reload()
    {
        if (_url == null) return;
        if (!_live && _lastTime > 0) _resumeMs = _lastTime;
        Attempt = 0;
        _retryTimer.Stop();
        Start();
    }

    public void TogglePause()
    {
        if (_live || _url == null) return;
        var pause = State != PlaybackState.Paused;
        _ = RunVlc(() => Player.SetPause(pause));
    }

    public void Seek(long ms)
    {
        if (_live || _url == null) return;
        var len = Length;
        if (len > 0) ms = Math.Min(ms, len - 3000);
        ms = Math.Max(0, ms);
        _lastProgressUtc = DateTime.UtcNow;
        _ = RunVlc(() => Player.Time = ms);
    }

    private void Start()
    {
        var gen = ++_generation;
        var url = _url!;
        var caching = NetworkCachingMs;
        _lastTime = -1;
        _lastProgressUtc = _startedUtc = DateTime.UtcNow;
        BufferPercent = 0;
        SetState(Attempt == 0 ? PlaybackState.Connecting : PlaybackState.Reconnecting);

        var options = new List<string> { $":network-caching={caching}", ":http-reconnect" };
        if (!_live && _resumeMs > 0)
            options.Add(":start-time=" + (_resumeMs / 1000.0).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));

        _ = RunVlc(() =>
        {
            if (gen != _generation) return; // l'utente ha già cambiato canale
            using var media = new Media(LibVLC, new Uri(url), options.ToArray());
            Player.Play(media);
        });
    }

    /// <summary>
    /// Le chiamate a libVLC che possono bloccare (Play/Stop) girano fuori dal thread UI,
    /// una alla volta: lo zapping veloce non congela mai l'interfaccia.
    /// </summary>
    private Task RunVlc(Action action) => Task.Run(async () =>
    {
        await _vlcGate.WaitAsync();
        try { action(); }
        catch (Exception ex) { Log.Write("Comando libVLC fallito", ex); }
        finally { _vlcGate.Release(); }
    });

    // Gli eventi libVLC arrivano su un thread interno: mai richiamare libVLC da lì.
    private void Post(Action a)
    {
        var gen = _generation;
        _ui.BeginInvoke(() =>
        {
            if (gen == _generation) a();
        });
    }

    private void OnPlaying()
    {
        if (_url == null) return;
        Volume = _volume;
        Muted = _muted;
        if (State != PlaybackState.Playing) SetState(PlaybackState.Playing);
    }

    private void OnBuffering(float cache)
    {
        if (_url == null) return;
        BufferPercent = cache;
        if (cache < 100f)
        {
            if (State == PlaybackState.Playing) SetState(PlaybackState.Buffering);
            else StateChanged?.Invoke();
        }
        else if (State == PlaybackState.Buffering)
        {
            SetState(PlaybackState.Playing);
        }
    }

    private void OnEndReached()
    {
        if (_url == null) return;
        if (!_live)
        {
            var len = Length;
            // Fine vera del file: niente riconnessione. Se invece la connessione è caduta a metà, si riprende da lì.
            if (len > 0 && _lastTime > 0 && len - _lastTime < 30_000)
            {
                _url = null;
                _generation++;
                _retryTimer.Stop();
                SetState(PlaybackState.Idle);
                Ended?.Invoke();
                return;
            }
        }
        OnFailure("flusso interrotto");
    }

    private void OnFailure(string reason)
    {
        if (_url == null || _retryTimer.IsEnabled) return;
        Log.Write($"Riproduzione: {reason}, riconnessione");
        ScheduleRetry();
    }

    private void ScheduleRetry()
    {
        Attempt++;
        if (!_live && Attempt > 6)
        {
            // Un file on demand che non si apre dopo ~30 s non si sistemerà da solo: meglio dirlo.
            _url = null;
            _generation++;
            SetState(PlaybackState.Idle);
            Failed?.Invoke();
            _ = RunVlc(() => Player.Stop());
            return;
        }
        if (!_live && _lastTime > 0) _resumeMs = Math.Max(0, _lastTime - 3000);
        var delayMs = Attempt == 1 ? 400 : Math.Min(1000 * (1 << Math.Min(Attempt - 2, 4)), 8000);
        _generation++; // ignora gli eventi residui del tentativo fallito
        SetState(PlaybackState.Reconnecting);
        _retryTimer.Interval = TimeSpan.FromMilliseconds(delayMs);
        _retryTimer.Start();
    }

    private void Watchdog()
    {
        if (_url == null || _retryTimer.IsEnabled) return;

        var now = DateTime.UtcNow;
        if (State == PlaybackState.Paused)
        {
            _lastProgressUtc = now;
            return;
        }

        long t;
        try { t = Player.Time; }
        catch { return; }

        if (t > 0 && t != _lastTime)
        {
            _lastTime = t;
            _lastProgressUtc = now;
            if (State is PlaybackState.Connecting or PlaybackState.Reconnecting) SetState(PlaybackState.Playing);
            if (Attempt > 0 && now - _startedUtc > TimeSpan.FromSeconds(10)) Attempt = 0;
            return;
        }

        var limit = _live
            ? (State == PlaybackState.Playing ? StallWhilePlaying : StallWhileOpening)
            : (State == PlaybackState.Playing ? VodStallWhilePlaying : VodStallWhileOpening);
        if (now - _lastProgressUtc > limit)
        {
            Log.Write($"Watchdog: flusso fermo da {(now - _lastProgressUtc).TotalSeconds:0}s, riapro il canale");
            ScheduleRetry();
        }
    }

    private void SetState(PlaybackState s)
    {
        State = s;
        StateChanged?.Invoke();
        PowerManagement.KeepAwake(s is not (PlaybackState.Idle or PlaybackState.Paused));
    }

    public IReadOnlyList<(int Id, string Name)> GetAudioTracks()
    {
        try
        {
            return Player.AudioTrackDescription.Where(t => t.Id >= 0).Select(t => (t.Id, t.Name ?? $"Traccia {t.Id}")).ToList();
        }
        catch { return []; }
    }

    public int CurrentAudioTrack
    {
        get { try { return Player.AudioTrack; } catch { return -1; } }
        set { try { Player.SetAudioTrack(value); } catch { } }
    }

    public IReadOnlyList<(int Id, string Name)> GetSubtitleTracks()
    {
        try
        {
            return Player.SpuDescription.Where(t => t.Id >= 0).Select(t => (t.Id, t.Name ?? $"Sottotitoli {t.Id}")).ToList();
        }
        catch { return []; }
    }

    /// <summary>-1 = disattivati.</summary>
    public int CurrentSubtitle
    {
        get { try { return Player.Spu; } catch { return -1; } }
        set { try { Player.SetSpu(value); } catch { } }
    }

    /// <summary>null = automatico, altrimenti "16:9", "4:3"…</summary>
    public string? AspectRatio
    {
        get => Player.AspectRatio;
        set { try { Player.AspectRatio = value; } catch { } }
    }

    public void Dispose()
    {
        _watchdog.Stop();
        _retryTimer.Stop();
        _url = null;
        PowerManagement.KeepAwake(false);
        // Stop può bloccare: in un thread a parte, con un limite di tempo per non bloccare la chiusura.
        Task.Run(() =>
        {
            try
            {
                Player.Stop();
                Player.Dispose();
                LibVLC.Dispose();
            }
            catch { }
        }).Wait(TimeSpan.FromSeconds(2));
    }
}

/// <summary>Evita che schermo e PC vadano in sospensione mentre si guarda un canale.</summary>
internal static class PowerManagement
{
    private const uint EsContinuous = 0x80000000;
    private const uint EsSystemRequired = 0x00000001;
    private const uint EsDisplayRequired = 0x00000002;

    private static bool _active;

    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint esFlags);

    public static void KeepAwake(bool on)
    {
        if (on == _active) return;
        _active = on;
        SetThreadExecutionState(on ? EsContinuous | EsSystemRequired | EsDisplayRequired : EsContinuous);
    }
}
