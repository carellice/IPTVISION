using System.Text.Json.Nodes;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Un profilo dell'account del server di casa: preferiti, Continua a guardare, La mia lista e "Nascondi XXX" suoi.</summary>
public sealed record ServerProfile(int Id, string Name, bool HasPin)
{
    public string Initial => Name.Length > 0 ? Name[..1].ToUpperInvariant() : "?";
}

/// <summary>
/// Profili del server di casa. Con più profili, all'apertura compare "Chi guarda?"; quelli col PIN lo chiedono
/// con il campo già pronto per scrivere. Dalle impostazioni si cambia profilo.
/// </summary>
public sealed partial class MainViewModel
{
    [ObservableProperty] private IReadOnlyList<ServerProfile> _profiles = [];
    [ObservableProperty] private int _currentProfileId;
    [ObservableProperty] private bool _isProfilePickerOpen;
    /// <summary>Il profilo scelto che chiede il PIN; null mentre si sceglie.</summary>
    [ObservableProperty] private ServerProfile? _lockedProfile;
    [ObservableProperty] private string? _profileError;
    [ObservableProperty] private bool _profileBusy;

    /// <summary>All'apertura, finché non si sa se ci sono più profili: niente ripresa automatica del canale.</summary>
    private bool _profilesPending;
    private bool _pickerAtStart;

    public bool HasProfiles => Profiles.Count > 1;
    public string CurrentProfileName => Profiles.FirstOrDefault(p => p.Id == CurrentProfileId)?.Name ?? "";
    public bool IsPinStep => LockedProfile != null;

    partial void OnProfilesChanged(IReadOnlyList<ServerProfile> value) { OnPropertyChanged(nameof(HasProfiles)); OnPropertyChanged(nameof(CurrentProfileName)); }
    partial void OnCurrentProfileIdChanged(int value) => OnPropertyChanged(nameof(CurrentProfileName));
    partial void OnIsProfilePickerOpenChanged(bool value) => OnPropertyChanged(nameof(ShowVideo));
    partial void OnLockedProfileChanged(ServerProfile? value) => OnPropertyChanged(nameof(IsPinStep));

    private void ShowProfiles(JsonObject o)
    {
        Profiles = (o["profiles"] as JsonArray)?.OfType<JsonObject>()
            .Select(p => new ServerProfile((int?)p["id"] ?? 0, (string?)p["name"] ?? "", (bool?)p["hasPin"] ?? false)).ToList() ?? [];
        CurrentProfileId = (int?)o["current"] ?? 0;
    }

    private async Task LoadProfilesAsync(bool atStart)
    {
        if (_settings.HomeServer is not { } url) return;
        try
        {
            ShowProfiles(await ServerApi.ProfilesAsync(url, Token));
            if (atStart && HasProfiles) { _pickerAtStart = true; OpenPicker(); }
        }
        catch (ServerException)
        {
            // Server più vecchio o non raggiungibile: si resta sul profilo di sempre.
        }
        finally
        {
            if (atStart)
            {
                _profilesPending = false;
                if (!IsProfilePickerOpen) AutoPlay();
            }
        }
    }

    private string Token => SettingsService.Unprotect(_settings.ProtectedPassword) ?? "";

    private void OpenPicker()
    {
        ProfileError = null;
        LockedProfile = null;
        IsProfilePickerOpen = true;
    }

    [RelayCommand]
    private async Task ChangeProfile()
    {
        IsSettingsOpen = false;
        _pickerAtStart = false;
        await LoadProfilesAsync(atStart: false);
        OpenPicker();
    }

    /// <summary>Tocca un profilo: col PIN si apre il campo, senza si entra subito.</summary>
    [RelayCommand]
    private async Task ChooseProfile(ServerProfile? p)
    {
        if (p == null || ProfileBusy) return;
        ProfileError = null;
        if (p.HasPin) LockedProfile = p;
        else await SwitchProfileAsync(p, "");
    }

    /// <summary>Esc: dal PIN si torna alla scelta; dalla scelta si chiude (all'apertura si resta sul profilo di prima).</summary>
    public void BackFromProfiles()
    {
        if (LockedProfile != null) { LockedProfile = null; ProfileError = null; return; }
        IsProfilePickerOpen = false;
        if (_pickerAtStart) { _pickerAtStart = false; AutoPlay(); }
    }

    /// <summary>Passa a un altro profilo: prima partono le modifiche fatte qui, poi arrivano preferiti e posizioni del nuovo.</summary>
    public async Task SwitchProfileAsync(ServerProfile p, string pin)
    {
        if (_settings.HomeServer is not { } url) return;
        ProfileBusy = true;
        ProfileError = null;
        try
        {
            await FlushServerOpsAsync();
            var o = await ServerApi.UseProfileAsync(url, Token, p.Id, pin);
            if (p.Id != CurrentProfileId)
            {
                LeaveVod();
                Player.Stop();
                if (CurrentChannel != null) CurrentChannel.IsPlaying = false;
                CurrentChannel = null;
                NowPlayingTitle = NowPlayingSubtitle = null;
            }
            ShowProfiles(o);
            _pendingOps.Clear();
            _settings.HomeRevision = -1;
            if (o["state"] is JsonObject state) ApplyServerState(state);
            LockedProfile = null;
            IsProfilePickerOpen = false;
            if (_pickerAtStart) { _pickerAtStart = false; AutoPlay(); }
        }
        catch (ServerException ex)
        {
            ProfileError = ex.Message;
        }
        finally
        {
            ProfileBusy = false;
        }
    }
}
