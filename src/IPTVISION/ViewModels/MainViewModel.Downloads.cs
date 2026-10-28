using System.Diagnostics;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Film ed episodi scaricati per guardarli senza connessione.</summary>
public sealed partial class MainViewModel
{
    public DownloadService DownloadService { get; } = new();

    [ObservableProperty] private bool _isDownloadsOpen;

    public bool HasDownloads => DownloadService.Items.Count > 0;
    public bool HasActiveDownloads => DownloadService.Items.Any(i => i.State is DownloadState.Queued or DownloadState.Running);

    public string DownloadsSummary
    {
        get
        {
            var done = DownloadService.Items.Count(i => i.IsDone);
            return $"{(done == 1 ? "1 scaricato" : $"{done} scaricati")} · {DownloadService.FormatBytes(DownloadService.UsedBytes)} occupati · {DownloadService.FormatBytes(DownloadService.FreeBytes)} liberi";
        }
    }

    private void InitDownloads()
    {
        DownloadService.Changed += () =>
        {
            OnPropertyChanged(nameof(HasDownloads));
            OnPropertyChanged(nameof(HasActiveDownloads));
            OnPropertyChanged(nameof(DownloadsSummary));
        };
        // Download rimasti a metà alla chiusura: ripartono da dove erano arrivati.
        _ = DownloadService.PumpAsync();
    }

    partial void OnIsDownloadsOpenChanged(bool value)
    {
        if (value) { IsSettingsOpen = false; OnPropertyChanged(nameof(DownloadsSummary)); }
    }

    partial void OnIsSettingsOpenChanged(bool value)
    {
        if (value) IsDownloadsOpen = false;
    }

    [RelayCommand]
    private void ToggleDownloads() => IsDownloadsOpen = !IsDownloadsOpen;

    /// <summary>Scarica film, episodi o (per una serie) tutti gli episodi. Restituisce false se non c'è niente da scaricare.</summary>
    public void Download(object? item)
    {
        switch (item)
        {
            case Movie m: DownloadMovie(m); break;
            case Episode ep: DownloadEpisode(ep); break;
            case Series s: _ = DownloadSeriesAsync(s); break;
        }
    }

    public void DownloadMovie(Movie m)
    {
        if (_client == null) return;
        if (DownloadService.Get(m.Key) != null) { ShowToast("Già tra i download"); return; }
        DownloadService.Add(new DownloadItem
        {
            Key = m.Key, Title = m.Name, Image = m.Data.Poster, Url = _client.GetMovieUrl(m.StreamId, m.Extension),
            FileName = DownloadService.FileNameFor(m.Name, m.Key, m.Extension), MovieId = m.StreamId, Extension = m.Extension,
        });
        ShowToast($"Download avviato · {m.Name}");
    }

    public void DownloadEpisode(Episode ep, bool quiet = false)
    {
        if (_client == null || DownloadService.Get(ep.Key) != null) return;
        var series = _series.FirstOrDefault(s => s.SeriesId == ep.SeriesId) ?? (OpenSeries?.SeriesId == ep.SeriesId ? OpenSeries : null);
        var name = series?.Name ?? "Serie TV";
        DownloadService.Add(new DownloadItem
        {
            Key = ep.Key, Title = $"{name} · {ep.Label}", Image = ep.Image ?? series?.Data.Cover, Url = _client.GetEpisodeUrl(ep.Id, ep.Extension),
            FileName = DownloadService.FileNameFor($"{name} {ep.Label}", ep.Key, ep.Extension),
            EpisodeId = ep.Id, SeriesId = ep.SeriesId, SeriesName = name, Season = ep.Season, Number = ep.Number,
            EpisodeTitle = ep.DisplayTitle, Extension = ep.Extension,
        });
        if (!quiet) ShowToast($"Download avviato · {name} {ep.Label}");
    }

    private void DownloadEpisodes(IEnumerable<Episode> eps)
    {
        var missing = eps.Where(e => DownloadService.Get(e.Key) == null).ToList();
        if (missing.Count == 0) { ShowToast("Episodi già tra i download"); return; }
        foreach (var e in missing) DownloadEpisode(e, quiet: true);
        ShowToast(missing.Count == 1 ? "1 episodio in download" : $"{missing.Count} episodi in download");
    }

    [RelayCommand]
    private void DownloadSeason()
    {
        if (OpenSeries == null || SelectedSeason == null || !_seriesInfo.TryGetValue(OpenSeries.SeriesId, out var info)) return;
        DownloadEpisodes(info.Episodes.Where(e => e.Season == SelectedSeason.Number));
    }

    private async Task DownloadSeriesAsync(Series s)
    {
        var info = await GetSeriesInfoAsync(s, CancellationToken.None);
        if (info != null) DownloadEpisodes(info.Episodes);
    }

    [RelayCommand]
    public void PlayDownload(DownloadItem? d)
    {
        if (d == null) return;
        if (d.IsFailed) { DownloadService.Retry(d); return; }
        if (!d.IsDone) return;
        if (!d.IsEpisode)
        {
            var known = _movies.FirstOrDefault(m => m.StreamId == d.MovieId);
            PlayMovie(known ?? new Movie(new VodData { StreamId = d.MovieId ?? 0, Name = d.Title, Poster = d.Image, Extension = d.Extension }));
            return;
        }
        var ep = (_seriesInfo.GetValueOrDefault(d.SeriesId ?? 0)?.Episodes.FirstOrDefault(e => e.Id == d.EpisodeId)) ?? ToEpisode(d);
        PlayEpisode(ep);
    }

    [RelayCommand]
    private async Task DeleteDownload(DownloadItem? d)
    {
        if (d == null) return;
        if (d.IsDone && IsVod && (CurrentMovie?.Key == d.Key || CurrentEpisode?.Key == d.Key))
        {
            // Il lettore tiene aperto il file: prima si ferma, poi si cancella.
            LeaveVod();
            Player.Stop();
            NowPlayingTitle = NowPlayingSubtitle = null;
            await Task.Delay(800);
        }
        DownloadService.Remove(d);
    }

    [RelayCommand]
    private void OpenDownloadsFolder()
    {
        try
        {
            Directory.CreateDirectory(DownloadService.Folder);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{DownloadService.Folder}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log.Write("Cartella download non aperta", ex);
        }
    }

    /// <summary>Episodi scaricati della stessa serie, in ordine: servono per successivo e precedente senza connessione.</summary>
    private List<Episode> DownloadedEpisodes(int seriesId) => DownloadService.Items
        .Where(i => i.IsEpisode && i.IsDone && i.SeriesId == seriesId)
        .OrderBy(i => i.Season).ThenBy(i => i.Number)
        .Select(ToEpisode).ToList();

    private static Episode ToEpisode(DownloadItem d) => new()
    {
        Id = d.EpisodeId!, SeriesId = d.SeriesId ?? 0, Season = d.Season, Number = d.Number,
        Title = d.EpisodeTitle ?? "", Extension = d.Extension, Image = d.Image,
    };

    private string? DownloadedSeriesName(int seriesId) =>
        DownloadService.Items.FirstOrDefault(i => i.SeriesId == seriesId)?.SeriesName;
}
