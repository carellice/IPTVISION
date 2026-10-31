using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Film e serie TV (on demand): catalogo, dettaglio serie, riproduzione con ripresa.</summary>
public sealed partial class MainViewModel
{
    private static readonly TimeSpan LibraryMaxAge = TimeSpan.FromHours(12);

    private readonly PositionStore _positions = PositionStore.Load();
    private readonly Dictionary<int, SeriesInfo> _seriesInfo = [];
    private DispatcherTimer _positionTimer = null!;
    private DispatcherTimer _nextTimer = null!;
    private int _positionTicks;

    private List<Movie> _movies = [];
    private List<Series> _series = [];
    private List<Category> _vodCats = [];
    private List<Category> _seriesCats = [];
    private (List<Category> Cats, List<VodData> Items)? _rawMovies;
    private (List<Category> Cats, List<SeriesData> Items)? _rawSeries;
    private Task? _moviesTask;
    private Task? _seriesTask;
    private Series? _playingSeries;
    private CancellationTokenSource? _seriesCts;

    // ---------- Stato ----------

    [ObservableProperty] private IReadOnlyList<Movie> _visibleMovies = [];
    [ObservableProperty] private IReadOnlyList<Series> _visibleSeries = [];
    [ObservableProperty] private bool _isLibraryLoading;

    [ObservableProperty] private Series? _openSeries;
    [ObservableProperty] private string? _openSeriesPlot;
    [ObservableProperty] private string? _openSeriesMeta;
    [ObservableProperty] private IReadOnlyList<SeasonItem> _seasons = [];
    [ObservableProperty] private SeasonItem? _selectedSeason;
    [ObservableProperty] private IReadOnlyList<Episode> _visibleEpisodes = [];
    [ObservableProperty] private bool _isSeriesLoading;
    [ObservableProperty] private string? _seriesError;

    [ObservableProperty] private Movie? _currentMovie;
    [ObservableProperty] private Episode? _currentEpisode;
    [ObservableProperty] private bool _isVod;
    [ObservableProperty] private ArtworkItem? _nowPlayingArtwork;
    [ObservableProperty] private string? _nowPlayingMeta;
    [ObservableProperty] private string? _nowPlayingPlot;

    [ObservableProperty] private long _positionMs;
    [ObservableProperty] private long _durationMs;
    [ObservableProperty] private string _positionText = "0:00";
    [ObservableProperty] private string _durationText = "0:00";
    [ObservableProperty] private bool _hasPreviousEpisode;
    [ObservableProperty] private bool _hasNextEpisode;

    [ObservableProperty] private Episode? _nextEpisodeOffer;
    [ObservableProperty] private int _nextEpisodeCountdown;

    private void InitLibrary()
    {
        _positionTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _positionTimer.Tick += (_, _) => TrackPosition();
        _positionTimer.Start();

        _nextTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _nextTimer.Tick += (_, _) =>
        {
            if (NextEpisodeOffer == null) { _nextTimer.Stop(); return; }
            if (--NextEpisodeCountdown <= 0) PlayNextEpisodeNow();
        };
    }

    private void ResetLibrary()
    {
        _movies = [];
        _rawMovies = null;
        _rawSeries = null;
        _series = [];
        _vodCats = [];
        _seriesCats = [];
        _moviesTask = _seriesTask = null;
        _seriesInfo.Clear();
        VisibleMovies = [];
        VisibleSeries = [];
        OpenSeries = null;
    }

    partial void OnNextEpisodeOfferChanged(Episode? value) => ShowIdlePlaceholder = IsIdle && value == null;

    partial void OnVisibleMoviesChanged(IReadOnlyList<Movie> value) => NotifyCounts();
    partial void OnVisibleSeriesChanged(IReadOnlyList<Series> value) => NotifyCounts();

    // ---------- Caricamento catalogo ----------

    private Task EnsureMoviesAsync() => _moviesTask ??= LoadMoviesAsync(force: false);
    private Task EnsureSeriesAsync() => _seriesTask ??= LoadSeriesAsync(force: false);

    private Task ReloadMoviesAsync() => _moviesTask = LoadMoviesAsync(force: true);
    private Task ReloadSeriesAsync() => _seriesTask = LoadSeriesAsync(force: true);

    private async Task LoadMoviesAsync(bool force)
    {
        if (_client == null) return;
        var client = _client;
        IsRefreshing = true;
        IsLibraryLoading = _movies.Count == 0;
        try
        {
            var cache = await Task.Run(() => CacheService.LoadLibrary<VodData>("vod", client.Account.Key));
            if (cache != null && _movies.Count == 0) PopulateMovies(cache.Categories, cache.Items);
            if (cache != null && !force && DateTimeOffset.Now - cache.SavedAt < LibraryMaxAge) return;

            var cats = await client.GetVodCategoriesAsync(CancellationToken.None);
            var items = await client.GetVodStreamsAsync(CancellationToken.None);
            if (client != _client) return;
            _ = Task.Run(() => CacheService.SaveLibrary("vod", client.Account.Key, new LibraryCache<VodData> { SavedAt = DateTimeOffset.Now, Categories = cats, Items = items }));
            PopulateMovies(cats, items);
            if (force) ShowToast($"Film aggiornati · {items.Count}");
        }
        catch (XtreamException ex)
        {
            ShowToast(_movies.Count == 0 ? ex.Message : "Server non raggiungibile: uso l'elenco film salvato");
            if (_movies.Count == 0) _moviesTask = null; // riprova alla prossima apertura
        }
        finally
        {
            IsLibraryLoading = false;
            IsRefreshing = false;
        }
    }

    private async Task LoadSeriesAsync(bool force)
    {
        if (_client == null) return;
        var client = _client;
        IsRefreshing = true;
        IsLibraryLoading = _series.Count == 0;
        try
        {
            var cache = await Task.Run(() => CacheService.LoadLibrary<SeriesData>("series", client.Account.Key));
            if (cache != null && _series.Count == 0) PopulateSeries(cache.Categories, cache.Items);
            if (cache != null && !force && DateTimeOffset.Now - cache.SavedAt < LibraryMaxAge) return;

            var cats = await client.GetSeriesCategoriesAsync(CancellationToken.None);
            var items = await client.GetSeriesAsync(CancellationToken.None);
            if (client != _client) return;
            _ = Task.Run(() => CacheService.SaveLibrary("series", client.Account.Key, new LibraryCache<SeriesData> { SavedAt = DateTimeOffset.Now, Categories = cats, Items = items }));
            if (force) _seriesInfo.Clear();
            PopulateSeries(cats, items);
            if (force) ShowToast($"Serie aggiornate · {items.Count}");
        }
        catch (XtreamException ex)
        {
            ShowToast(_series.Count == 0 ? ex.Message : "Server non raggiungibile: uso l'elenco serie salvato");
            if (_series.Count == 0) _seriesTask = null;
        }
        finally
        {
            IsLibraryLoading = false;
            IsRefreshing = false;
        }
    }

    private void PopulateMovies(List<Category> cats, List<VodData> items)
    {
        var playingId = CurrentMovie?.StreamId;
        _rawMovies = (cats, items);
        (cats, items) = WithoutHidden(cats, items, i => i.CategoryId);
        _vodCats = cats;
        _movies = items.GroupBy(i => i.StreamId).Select(g => g.First()).Select(d =>
        {
            var m = new Movie(d);
            m.Progress = _positions.GetProgress(m.Key);
            return m;
        }).ToList();
        if (playingId is int id && _movies.FirstOrDefault(m => m.StreamId == id) is { } cur)
        {
            cur.IsPlaying = true;
            CurrentMovie = cur;
        }
        if (Mode == LibraryMode.Movies) { RebuildCategories(); ApplyFilter(); }
    }

    private void PopulateSeries(List<Category> cats, List<SeriesData> items)
    {
        var playingId = _playingSeries?.SeriesId;
        _rawSeries = (cats, items);
        (cats, items) = WithoutHidden(cats, items, i => i.CategoryId);
        _seriesCats = cats;
        _series = items.GroupBy(i => i.SeriesId).Select(g => g.First()).Select(d =>
        {
            var s = new Series(d);
            s.Progress = _positions.GetLastEpisode(d.SeriesId) != null ? 0.5 : 0;
            return s;
        }).ToList();
        if (playingId is int id && _series.FirstOrDefault(s => s.SeriesId == id) is { } cur)
        {
            cur.IsPlaying = true;
            _playingSeries = cur;
        }
        if (Mode == LibraryMode.Series) { RebuildCategories(); ApplyFilter(); }
    }

    private void RefreshContinueCount()
    {
        var c = Categories.FirstOrDefault(x => x.IsContinue);
        var n = Mode switch
        {
            LibraryMode.Movies => _movies.Count(m => m.HasProgress),
            LibraryMode.Series => _series.Count(s => s.HasProgress),
            _ => 0,
        };
        if (c != null) c.Count = n;
        else if (n > 0 && Mode != LibraryMode.Live) RebuildCategories();
    }

    // ---------- Dettaglio serie ----------

    [RelayCommand]
    public async Task OpenSeriesDetail(Series? s)
    {
        if (s == null || _client == null) return;
        _seriesCts?.Cancel();
        var cts = _seriesCts = new CancellationTokenSource();

        OpenSeries = s;
        OpenSeriesPlot = s.Data.Plot;
        OpenSeriesMeta = s.Meta;
        Seasons = [];
        VisibleEpisodes = [];
        SeriesError = null;

        var info = await GetSeriesInfoAsync(s, cts.Token);
        if (cts.IsCancellationRequested || OpenSeries != s) return;
        if (info == null) return;

        OpenSeriesPlot = info.Plot ?? s.Data.Plot;
        OpenSeriesMeta = TextHelpers.JoinMeta(info.Year ?? s.Data.Year, info.Genre ?? s.Data.Genre,
            info.Episodes.Count == 1 ? "1 episodio" : $"{info.Episodes.Count} episodi");
        Seasons = info.Episodes.GroupBy(e => e.Season).OrderBy(g => g.Key)
            .Select(g => new SeasonItem(g.Key, $"Stagione {g.Key}", g.Count())).ToList();
        if (info.Episodes.Count == 0) SeriesError = "Nessun episodio disponibile per questa serie.";

        // Si riapre sulla stagione dell'ultimo episodio visto.
        var lastId = _positions.GetLastEpisode(s.SeriesId)?.EpisodeId;
        var last = info.Episodes.FirstOrDefault(e => e.Id == lastId);
        SelectedSeason = Seasons.FirstOrDefault(x => x.Number == last?.Season) ?? Seasons.FirstOrDefault();
    }

    private async Task<SeriesInfo?> GetSeriesInfoAsync(Series s, CancellationToken ct)
    {
        if (_seriesInfo.TryGetValue(s.SeriesId, out var cached)) return cached;
        if (_client == null) return null;
        IsSeriesLoading = true;
        try
        {
            var info = await _client.GetSeriesInfoAsync(s.SeriesId, ct);
            foreach (var e in info.Episodes)
            {
                e.Progress = _positions.GetProgress(e.Key);
                e.IsWatched = _positions.IsWatched(e.Key);
                e.IsPlaying = CurrentEpisode?.Id == e.Id;
                if (e.IsPlaying) CurrentEpisode = e;
            }
            _seriesInfo[s.SeriesId] = info;
            return info;
        }
        catch (XtreamException ex)
        {
            SeriesError = ex.Message;
            return null;
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        finally
        {
            IsSeriesLoading = false;
        }
    }

    partial void OnSelectedSeasonChanged(SeasonItem? value)
    {
        if (OpenSeries == null || value == null || !_seriesInfo.TryGetValue(OpenSeries.SeriesId, out var info))
        {
            VisibleEpisodes = [];
            return;
        }
        VisibleEpisodes = info.Episodes.Where(e => e.Season == value.Number).ToList();
        OnEpisodesShown();
    }

    [RelayCommand]
    private void CloseSeries() => OpenSeries = null;

    // ---------- Riproduzione on demand ----------

    [RelayCommand]
    public void PlayMovie(Movie? m)
    {
        // Scaricato: si guarda dal file, anche senza connessione.
        var url = m == null ? null : DownloadService.LocalFile(m.Key) ?? _client?.GetMovieUrl(m.StreamId, m.Extension);
        if (m == null || url == null) return;
        if (m == CurrentMovie && Player.IsActive)
        {
            MediaStarted?.Invoke(m);
            return;
        }
        EnterVod();
        CurrentMovie = m;
        m.IsPlaying = true;

        var resume = _positions.GetResumeMs(m.Key);
        Player.Play(url, live: false, startMs: resume);

        NowPlayingTitle = m.Name;
        NowPlayingSubtitle = null;
        NowPlayingMeta = m.Meta;
        NowPlayingPlot = null;
        NowPlayingArtwork = m;
        HasPreviousEpisode = HasNextEpisode = false;
        AfterVodStart(resume);
        MediaStarted?.Invoke(m);
        _ = LoadMovieInfoAsync(m);
    }

    private async Task LoadMovieInfoAsync(Movie m)
    {
        if (_client == null) return;
        try
        {
            var info = await _client.GetVodInfoAsync(m.StreamId, CancellationToken.None);
            if (info == null || CurrentMovie != m) return;
            NowPlayingMeta = TextHelpers.JoinMeta(info.Year ?? m.Data.Year, info.Genre, info.Duration,
                m.Data.Rating > 0 ? $"★ {m.Data.Rating.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)}" : null);
            NowPlayingPlot = info.Plot;
        }
        catch (XtreamException ex)
        {
            Log.Write("Info film non disponibili", ex);
        }
    }

    [RelayCommand]
    public void PlayEpisode(Episode? ep)
    {
        var url = ep == null ? null : DownloadService.LocalFile(ep.Key) ?? _client?.GetEpisodeUrl(ep.Id, ep.Extension);
        if (ep == null || url == null) return;
        if (ep == CurrentEpisode && Player.IsActive)
        {
            MediaStarted?.Invoke(ep);
            return;
        }
        var series = _series.FirstOrDefault(s => s.SeriesId == ep.SeriesId) ?? (OpenSeries?.SeriesId == ep.SeriesId ? OpenSeries : null);

        EnterVod();
        CurrentEpisode = ep;
        ep.IsPlaying = true;
        _playingSeries = series;
        if (series != null)
        {
            series.IsPlaying = true;
            series.Progress = 0.5;
        }

        var resume = _positions.GetResumeMs(ep.Key);
        Player.Play(url, live: false, startMs: resume);
        _positions.SetLastEpisode(ep.SeriesId, ep.Id);
        _positions.Save();

        var info = _seriesInfo.GetValueOrDefault(ep.SeriesId);
        NowPlayingTitle = series?.Name ?? DownloadedSeriesName(ep.SeriesId) ?? "Serie TV";
        NowPlayingSubtitle = string.IsNullOrWhiteSpace(ep.Title) ? ep.Label : $"{ep.Label} · {ep.Title}";
        NowPlayingMeta = TextHelpers.JoinMeta(info?.Year ?? series?.Data.Year, info?.Genre ?? series?.Data.Genre, ep.DurationText);
        NowPlayingPlot = ep.Plot ?? info?.Plot ?? series?.Data.Plot;
        NowPlayingArtwork = (ArtworkItem?)series ?? ep;
        HasPreviousEpisode = EpisodeOffset(ep, -1) != null;
        HasNextEpisode = EpisodeOffset(ep, +1) != null;
        // Il dettaglio aperto segue l'episodio anche quando si passa alla stagione successiva.
        if (OpenSeries?.SeriesId == ep.SeriesId && SelectedSeason?.Number != ep.Season)
            SelectedSeason = Seasons.FirstOrDefault(x => x.Number == ep.Season) ?? SelectedSeason;
        AfterVodStart(resume);
        MediaStarted?.Invoke(ep);
        if (Mode == LibraryMode.Series) RefreshContinueCount();
    }

    private void EnterVod()
    {
        LeaveVod();
        if (CurrentChannel != null) CurrentChannel.IsPlaying = false;
        IsVod = true;
        PositionMs = DurationMs = 0;
        PositionText = DurationText = "0:00";
        _positionTicks = 0;
    }

    private void AfterVodStart(long resumeMs)
    {
        UpdatePlayGlyph();
        if (resumeMs > 0) ShowToast($"Riprendo da {TextHelpers.FormatTime(resumeMs)} · Home per ricominciare");
    }

    /// <summary>Salva la posizione ed esce dalla modalità film/episodio (passando alla TV o a un altro contenuto).</summary>
    private void LeaveVod()
    {
        if (!IsVod) return;
        SaveCurrentPosition();
        _positions.Save(force: true);
        CancelNextEpisode();
        if (CurrentMovie != null) CurrentMovie.IsPlaying = false;
        if (CurrentEpisode != null) CurrentEpisode.IsPlaying = false;
        if (_playingSeries != null) _playingSeries.IsPlaying = false;
        CurrentMovie = null;
        CurrentEpisode = null;
        _playingSeries = null;
        NowPlayingArtwork = null;
        NowPlayingMeta = NowPlayingPlot = null;
        IsVod = false;
    }

    private string? CurrentVodKey => CurrentMovie?.Key ?? CurrentEpisode?.Key;

    private void SaveCurrentPosition()
    {
        if (!IsVod || CurrentVodKey is not { } key) return;
        var pos = Player.IsActive ? Player.Time : PositionMs;
        var len = Player.IsActive ? Player.Length : DurationMs;
        if (pos <= 0 || len <= 0) return;
        _positions.Update(key, pos, len);
        var progress = _positions.GetProgress(key);
        if (CurrentMovie != null) CurrentMovie.Progress = progress;
        if (CurrentEpisode != null)
        {
            CurrentEpisode.Progress = progress;
            CurrentEpisode.IsWatched = _positions.IsWatched(key);
        }
    }

    private void TrackPosition()
    {
        if (!IsVod || !Player.IsActive) return;
        if (Player.State is not (PlaybackState.Playing or PlaybackState.Paused or PlaybackState.Buffering)) return;
        var len = Player.Length;
        var pos = Player.Time;
        if (len > 0 && len != DurationMs)
        {
            DurationMs = len;
            DurationText = TextHelpers.FormatTime(len);
        }
        if (!IsSeeking && pos > 0)
        {
            PositionMs = pos;
            PositionText = TextHelpers.FormatTime(pos);
        }
        if (++_positionTicks % 20 == 0) // ogni 10 s
        {
            var hadProgress = CurrentMovie?.HasProgress ?? true;
            SaveCurrentPosition();
            _positions.Save();
            if (CurrentMovie != null && hadProgress != CurrentMovie.HasProgress && Mode == LibraryMode.Movies) RefreshContinueCount();
        }
    }

    /// <summary>La vista lo imposta mentre si trascina la barra di avanzamento.</summary>
    public bool IsSeeking { get; set; }

    public void PreviewSeek(long ms) => PositionText = TextHelpers.FormatTime(ms);

    public void SeekTo(long ms)
    {
        if (!IsVod) return;
        Player.Seek(ms);
        PositionMs = ms;
        PositionText = TextHelpers.FormatTime(ms);
    }

    public void SeekBy(long deltaMs)
    {
        if (!IsVod || !Player.IsActive) return;
        var target = Math.Max(0, Player.Time + deltaMs);
        SeekTo(target);
        var sign = deltaMs < 0 ? "−" : "+";
        ShowToast($"{sign}{Math.Abs(deltaMs) / 1000} s  ·  {TextHelpers.FormatTime(target)}");
    }

    [RelayCommand]
    private void SkipBack() => SeekBy(-10_000);

    [RelayCommand]
    private void SkipForward() => SeekBy(30_000);

    /// <summary>Ferma il film o l'episodio: la posizione resta salvata per riprendere da lì.</summary>
    [RelayCommand]
    private void StopVod()
    {
        if (!IsVod) return;
        var mode = Mode;
        LeaveVod();
        Player.Stop();
        NowPlayingTitle = NowPlayingSubtitle = null;
        if (mode != LibraryMode.Live) RefreshContinueCount();
        ShowToast("Riproduzione interrotta");
        if (IsTvMode) ShowTvBrowser();
    }

    [RelayCommand]
    private void Restart()
    {
        if (IsVod && Player.IsActive) SeekTo(0);
    }

    private void ReplayCurrentVod()
    {
        var movie = CurrentMovie;
        var ep = CurrentEpisode;
        if (movie != null) { CurrentMovie = null; PlayMovie(movie); }
        else if (ep != null) { CurrentEpisode = null; PlayEpisode(ep); }
    }

    // ---------- Episodi successivi ----------

    private Episode? EpisodeOffset(Episode ep, int offset)
    {
        // Senza i dati della serie (per esempio offline) valgono gli episodi scaricati.
        var list = _seriesInfo.TryGetValue(ep.SeriesId, out var info) ? info.Episodes : DownloadedEpisodes(ep.SeriesId);
        var i = list.IndexOf(ep);
        if (i < 0) i = list.FindIndex(e => e.Id == ep.Id);
        var j = i + offset;
        return i >= 0 && j >= 0 && j < list.Count ? list[j] : null;
    }

    [RelayCommand]
    private void NextEpisode()
    {
        if (CurrentEpisode is { } ep && EpisodeOffset(ep, +1) is { } next) PlayEpisode(next);
    }

    [RelayCommand]
    private void PreviousEpisode()
    {
        if (CurrentEpisode is { } ep && EpisodeOffset(ep, -1) is { } prev) PlayEpisode(prev);
    }

    private void OnPlayerEnded()
    {
        if (!IsVod || CurrentVodKey is not { } key) return;
        _positions.MarkWatched(key);
        _positions.Save(force: true);
        if (CurrentMovie != null)
        {
            CurrentMovie.Progress = 1;
            ShowToast("Film terminato");
            if (Mode == LibraryMode.Movies) RefreshContinueCount();
        }
        if (CurrentEpisode is { } ep)
        {
            ep.Progress = 1;
            ep.IsWatched = true;
            if (EpisodeOffset(ep, +1) is { } next)
            {
                NextEpisodeOffer = next;
                NextEpisodeCountdown = 10;
                _nextTimer.Start();
            }
            else
            {
                ShowToast("Hai finito la serie");
            }
        }
        UpdatePlayGlyph();
    }

    [RelayCommand]
    private void PlayNextEpisodeNow()
    {
        var next = NextEpisodeOffer;
        CancelNextEpisode();
        if (next != null) PlayEpisode(next);
    }

    [RelayCommand]
    private void CancelNextEpisode()
    {
        _nextTimer.Stop();
        NextEpisodeOffer = null;
    }
}
