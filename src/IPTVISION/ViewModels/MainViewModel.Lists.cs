using System.Collections.ObjectModel;
using System.Text.Json.Nodes;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>Una lista salvata come la mostrano Impostazioni e schermata di accesso.</summary>
public sealed record SavedListItem(SavedList List, string Alias, string Detail, bool IsActive, int ServerIndex = -1);

/// <summary>
/// Più account Xtream salvati, ognuno col suo nome: si passa dall'uno all'altro senza riscrivere la password.
/// Col server di casa le liste sono quelle del server, uguali su ogni dispositivo.
/// </summary>
public sealed partial class MainViewModel
{
    [ObservableProperty] private string _loginAlias = "";

    public ObservableCollection<SavedListItem> SavedLists { get; } = [];

    public bool HasSavedLists => SavedLists.Count > 0;

    private void RefreshSavedLists()
    {
        if (IsHomeServer) { _ = LoadServerListsAsync(); return; }
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
            SavedLists.Add(new SavedListItem(l, l.Alias, $"{l.Username} · {ExpiryText(l.ExpiresAt)}", active));
        }
        OnPropertyChanged(nameof(HasSavedLists));
    }

    private static string ExpiryText(DateTimeOffset? e) => e is { } d ? $"scade il {d.ToLocalTime():dd/MM/yyyy}" : "nessuna scadenza nota";

    private async Task LoadServerListsAsync()
    {
        if (_settings.HomeServer is not { } url) return;
        JsonArray lists;
        try { lists = await ServerApi.ListsAsync(url, SettingsService.Unprotect(_settings.ProtectedPassword) ?? ""); }
        catch (ServerException ex) { ServerStatus = ex.Message; return; }
        SavedLists.Clear();
        foreach (var n in lists.OfType<JsonObject>())
        {
            var l = new SavedList
            {
                Alias = (string?)n["alias"] ?? "", Server = (string?)n["server"] ?? "", Username = (string?)n["username"] ?? "",
                ExpiresAt = (long?)n["expiresAt"] is { } sec ? DateTimeOffset.FromUnixTimeSeconds(sec) : null,
            };
            SavedLists.Add(new SavedListItem(l, l.Alias, $"{l.Username} · {ExpiryText(l.ExpiresAt)}", IsLoggedIn && (bool?)n["active"] == true, (int?)n["index"] ?? -1));
        }
        OnPropertyChanged(nameof(HasSavedLists));
    }

    /// <summary>Col server di casa: liste e guida ripartono da zero, il gettone del server resta.</summary>
    private async Task ReloadFromServerAsync(JsonObject? state)
    {
        var token = _settings.ProtectedPassword;
        ResetSession();
        _settings.ProtectedPassword = token;
        SettingsService.Save(_settings);
        CacheService.Clear();
        if (state != null) ApplyServerState(state);
        await InitializeAsync();
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
        if (item.IsActive) return;
        if (_settings.HomeServer is { } url)
        {
            try { await ReloadFromServerAsync(await ServerApi.UseListAsync(url, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "", item.ServerIndex)); }
            catch (ServerException ex) { ShowToast(ex.Message); }
            return;
        }
        if (IsLoggedIn) ResetSession();
        _settings.Server = item.List.Server;
        _settings.Username = item.List.Username;
        _settings.ProtectedPassword = item.List.ProtectedPassword;
        SettingsService.Save(_settings);
        LoginError = null;
        await InitializeAsync();
    }

    [RelayCommand]
    private async Task RemoveList(SavedListItem item)
    {
        if (_settings.HomeServer is { } url)
        {
            // Senza lista in uso il server non avrebbe niente da mostrare a nessun dispositivo.
            if (item.IsActive) { ShowToast("Prima passa a un'altra lista."); return; }
            try { await ServerApi.RemoveListAsync(url, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "", item.ServerIndex); }
            catch (ServerException ex) { ShowToast(ex.Message); }
            RefreshSavedLists();
            return;
        }
        _settings.Lists.Remove(item.List);
        SettingsService.Save(_settings);
        if (item.IsActive) ResetSession();
        RefreshSavedLists();
    }

    /// <summary>Torna alla schermata di accesso per una lista nuova; le liste salvate restano lì da scegliere.</summary>
    [RelayCommand]
    private void AddList()
    {
        var token = _settings.ProtectedPassword;
        ResetSession();
        if (IsHomeServer) { _settings.ProtectedPassword = token; SettingsService.Save(_settings); }
        LoginServer = LoginUsername = LoginAlias = "";
        LoginError = null;
    }
}
