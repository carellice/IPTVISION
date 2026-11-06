using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Una lista salvata come la mostrano Impostazioni e schermata di accesso.</summary>
public sealed record SavedListItem(SavedList List, string Alias, string Detail, bool IsActive);

/// <summary>Più account Xtream salvati, ognuno col suo nome: si passa dall'uno all'altro senza riscrivere la password.</summary>
public sealed partial class MainViewModel
{
    [ObservableProperty] private string _loginAlias = "";

    public ObservableCollection<SavedListItem> SavedLists { get; } = [];

    public bool HasSavedLists => SavedLists.Count > 0;

    private void RefreshSavedLists()
    {
        // Account salvati prima delle liste: quello in uso diventa la prima lista.
        if (_settings.Lists.Count == 0 && _settings.HasAccount && !IsHomeServer)
        {
            _settings.Lists.Add(new SavedList
            {
                Alias = _settings.Username!, Server = _settings.Server!, Username = _settings.Username!,
                ProtectedPassword = _settings.ProtectedPassword,
            });
            ScheduleSave();
        }
        SavedLists.Clear();
        foreach (var l in _settings.Lists)
        {
            var active = IsLoggedIn && !IsHomeServer && l.Is(_settings.Server, _settings.Username);
            var exp = l.ExpiresAt is { } e ? $"scade il {e.ToLocalTime():dd/MM/yyyy}" : "nessuna scadenza nota";
            SavedLists.Add(new SavedListItem(l, l.Alias, $"{l.Username} · {exp}", active));
        }
        OnPropertyChanged(nameof(HasSavedLists));
    }

    partial void OnIsLoggedInChanged(bool value) => RefreshSavedLists();

    /// <summary>Dopo un accesso riuscito: aggiunge la lista o aggiorna quella con stesso server e utente.</summary>
    private void SaveList(string server, string user, string protectedPassword, AuthInfo auth)
    {
        var l = _settings.Lists.FirstOrDefault(x => x.Is(server, user));
        if (l == null) _settings.Lists.Add(l = new SavedList { Server = server, Username = user });
        if (!string.IsNullOrWhiteSpace(LoginAlias) || l.Alias.Length == 0) l.Alias = string.IsNullOrWhiteSpace(LoginAlias) ? user : LoginAlias.Trim();
        l.ProtectedPassword = protectedPassword;
        l.ExpiresAt = auth.ExpiresAt;
        LoginAlias = "";
        SettingsService.Save(_settings);
        RefreshSavedLists();
    }

    /// <summary>La scadenza letta a ogni aggiornamento finisce anche nella lista in uso.</summary>
    private void UpdateListExpiry(AuthInfo auth)
    {
        if (IsHomeServer || _settings.Lists.FirstOrDefault(x => x.Is(_settings.Server, _settings.Username)) is not { } l) return;
        if (l.ExpiresAt == auth.ExpiresAt) return;
        l.ExpiresAt = auth.ExpiresAt;
        ScheduleSave();
        RefreshSavedLists();
    }

    [RelayCommand]
    private async Task UseList(SavedListItem item)
    {
        if (IsHomeServer || item.IsActive) return;
        if (IsLoggedIn) ResetSession();
        _settings.Server = item.List.Server;
        _settings.Username = item.List.Username;
        _settings.ProtectedPassword = item.List.ProtectedPassword;
        SettingsService.Save(_settings);
        LoginError = null;
        await InitializeAsync();
    }

    [RelayCommand]
    private void RemoveList(SavedListItem item)
    {
        _settings.Lists.Remove(item.List);
        SettingsService.Save(_settings);
        if (item.IsActive) ResetSession();
        RefreshSavedLists();
    }

    /// <summary>Torna alla schermata di accesso per una lista nuova; le liste salvate restano lì da scegliere.</summary>
    [RelayCommand]
    private void AddList()
    {
        ResetSession();
        LoginServer = LoginUsername = LoginAlias = "";
        LoginError = null;
    }
}
