using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Aggiornamenti: controllo all'avvio, download del setup e installazione silenziosa.</summary>
public sealed partial class MainViewModel
{
    [ObservableProperty] private UpdateInfo? _availableUpdate;
    [ObservableProperty] private bool _isCheckingUpdate;
    [ObservableProperty] private bool _isDownloadingUpdate;
    [ObservableProperty] private double _updateProgress;
    [ObservableProperty] private string _updateStatus = "";

    private CancellationTokenSource? _updateCts;

    public bool HasUpdate => AvailableUpdate != null;
    public string UpdateButtonText => AvailableUpdate is { } u ? $"Aggiorna alla versione {UpdateService.Format(u.Version)}" : "";
    public string? UpdateNotes => string.IsNullOrWhiteSpace(AvailableUpdate?.Notes) ? null : AvailableUpdate!.Notes;
    public string RepositoryUrl => UpdateService.RepositoryUrl;

    public bool AutoCheckUpdates
    {
        get => _settings.AutoCheckUpdates;
        set
        {
            _settings.AutoCheckUpdates = value;
            OnPropertyChanged();
            ScheduleSave();
        }
    }

    partial void OnAvailableUpdateChanged(UpdateInfo? value)
    {
        OnPropertyChanged(nameof(HasUpdate));
        OnPropertyChanged(nameof(UpdateButtonText));
        OnPropertyChanged(nameof(UpdateNotes));
    }

    private void InitUpdates()
    {
        UpdateStatus = $"Versione installata: {Version}";
        if (!_settings.AutoCheckUpdates) return;

        // Qualche secondo dopo l'avvio: prima parte il canale, poi si controlla.
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
        timer.Tick += (_, _) => { timer.Stop(); _ = CheckForUpdatesAsync(userInitiated: false); };
        timer.Start();
    }

    [RelayCommand]
    private Task CheckForUpdates() => CheckForUpdatesAsync(userInitiated: true);

    private async Task CheckForUpdatesAsync(bool userInitiated)
    {
        if (IsCheckingUpdate || IsDownloadingUpdate) return;
        IsCheckingUpdate = true;
        if (userInitiated) UpdateStatus = "Controllo in corso…";
        try
        {
            var info = await UpdateService.CheckAsync();
            AvailableUpdate = info;
            if (info != null)
            {
                UpdateStatus = $"Disponibile la versione {UpdateService.Format(info.Version)} (in uso {Version})";
                ShowToast($"Nuova versione {UpdateService.Format(info.Version)} disponibile · Impostazioni → Aggiornamenti");
            }
            else
            {
                UpdateStatus = $"Versione {Version}: è la più recente";
                if (userInitiated) ShowToast("IPTVISION è aggiornato");
            }
        }
        catch (Exception ex)
        {
            Log.Write("Controllo aggiornamenti non riuscito", ex);
            if (userInitiated)
            {
                UpdateStatus = "Impossibile controllare gli aggiornamenti: verifica la connessione";
                ShowToast("Controllo aggiornamenti non riuscito");
            }
        }
        finally
        {
            IsCheckingUpdate = false;
        }
    }

    [RelayCommand]
    private async Task InstallUpdate()
    {
        if (AvailableUpdate is not { } info || IsDownloadingUpdate) return;
        IsDownloadingUpdate = true;
        UpdateProgress = 0;
        _updateCts = new CancellationTokenSource();
        var progress = new Progress<double>(p =>
        {
            UpdateProgress = p;
            UpdateStatus = info.Size > 0
                ? $"Download {p * info.Size / 1048576.0:0.0} di {info.Size / 1048576.0:0.0} MB"
                : $"Download {p:P0}";
        });
        try
        {
            var setup = await UpdateService.DownloadAsync(info, progress, _updateCts.Token);
            UpdateStatus = "Installazione: IPTVISION si riaprirà da solo";
            SaveCurrentPosition();
            UpdateService.LaunchInstaller(setup);
            Application.Current.Shutdown();
        }
        catch (OperationCanceledException)
        {
            UpdateStatus = "Download annullato";
        }
        catch (Exception ex)
        {
            Log.Write("Aggiornamento non riuscito", ex);
            UpdateStatus = "Download non riuscito: riprova più tardi";
            ShowToast("Aggiornamento non riuscito");
        }
        finally
        {
            IsDownloadingUpdate = false;
            _updateCts?.Dispose();
            _updateCts = null;
        }
    }

    [RelayCommand]
    private void CancelUpdate() => _updateCts?.Cancel();
}
