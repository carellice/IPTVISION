using System.Text.Json.Nodes;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

/// <summary>
/// Server di casa: IPTVISION su CasaOS fa da server Xtream. Le liste, la guida e i flussi passano da lì,
/// preferiti e posizioni sono quelli dell'account del server e restano uguali su ogni dispositivo.
/// </summary>
public sealed partial class MainViewModel
{
    private readonly List<JsonObject> _pendingOps = [];
    private DispatcherTimer? _serverTimer;

    /// <summary>La schermata di accesso mostra il modulo del server di casa invece di quello Xtream.</summary>
    [ObservableProperty] private bool _isServerLogin;
    [ObservableProperty] private string _serverAddress = "";
    [ObservableProperty] private string _serverUser = "";
    [ObservableProperty] private string _serverInvite = "";
    [ObservableProperty] private bool _serverRegister;
    [ObservableProperty] private bool _serverBusy;
    [ObservableProperty] private string? _serverError;
    [ObservableProperty] private string? _serverStatus;
    /// <summary>Rete del server di casa, per esempio "VPN attiva · Svizzera · 185.1.2.3"; null senza server.</summary>
    [ObservableProperty] private string? _serverNetwork;
    /// <summary>Colore del pallino: verde con la VPN attiva, rosso senza, grigio se non si sa.</summary>
    [ObservableProperty] private string _serverNetworkColor = "#5C6473";

    public bool IsHomeServer => _settings.HomeServer != null;
    public string? HomeServerUrl => _settings.HomeServer;

    private void InitServer()
    {
        _positions.Changed += op => QueueServerOp(op);
        ServerAddress = _settings.HomeServer ?? "";
        // Le modifiche fatte qui partono, quelle degli altri dispositivi arrivano.
        _serverTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        _serverTimer.Tick += (_, _) => { _ = FlushServerOpsAsync(); _ = PullServerAsync(); _ = LoadServerNetworkAsync(); };
        _serverTimer.Start();
        if (IsHomeServer) { _ = PullServerAsync(force: true); _ = LoadServerNetworkAsync(); }
    }

    /// <summary>Se il server di casa esce su Internet con la VPN o no, con paese e indirizzo.</summary>
    private async Task LoadServerNetworkAsync()
    {
        if (_settings.HomeServer is not { } url) { ServerNetwork = null; return; }
        try
        {
            var n = await ServerApi.NetworkAsync(url, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "");
            ServerNetwork = (string?)n["label"];
            ServerNetworkColor = n["vpn"] is JsonValue v && v.TryGetValue<bool>(out var vpn) ? (vpn ? "#3DDC97" : "#FF5D6C") : "#5C6473";
        }
        catch (ServerException)
        {
            ServerNetwork = null;
        }
    }

    private void NotifyServer()
    {
        OnPropertyChanged(nameof(IsHomeServer));
        OnPropertyChanged(nameof(HomeServerUrl));
    }

    private void QueueServerOp(JsonObject op, bool now = false)
    {
        if (!IsHomeServer) return;
        _pendingOps.Add(op);
        if (now) _ = FlushServerOpsAsync();
    }

    private async Task FlushServerOpsAsync()
    {
        if (_settings.HomeServer is not { } url || _pendingOps.Count == 0) return;
        var token = SettingsService.Unprotect(_settings.ProtectedPassword) ?? "";
        var ops = _pendingOps.ToList();
        _pendingOps.Clear();
        try
        {
            ApplyServerState(await ServerApi.OpsAsync(url, token, new JsonArray(ops.Select(o => (JsonNode)o.DeepClone()).ToArray())));
        }
        catch (ServerException ex)
        {
            // Server spento o fuori rete: le modifiche restano in coda e ripartono al prossimo giro.
            _pendingOps.InsertRange(0, ops);
            ServerStatus = ex.Message;
        }
    }

    [RelayCommand]
    private Task PullServer() => PullServerAsync(force: true);

    private async Task PullServerAsync(bool force = false)
    {
        if (_settings.HomeServer is not { } url) return;
        var token = SettingsService.Unprotect(_settings.ProtectedPassword) ?? "";
        try
        {
            if (await ServerApi.StateAsync(url, token, force ? null : _settings.HomeRevision) is { } state) ApplyServerState(state);
            ServerStatus = $"Canali, film e serie passano dal server. Aggiornato alle {DateTime.Now:HH:mm}.";
        }
        catch (ServerException ex)
        {
            ServerStatus = ex.Message;
        }
    }

    /// <summary>Preferiti e posizioni dell'account, cambiati magari da un altro dispositivo.</summary>
    private void ApplyServerState(JsonObject state)
    {
        if (_pendingOps.Count > 0) return; // prima partono le nostre
        _settings.HomeRevision = (int?)state["revision"] ?? -1;
        _settings.Favorites = (state["favorites"] as JsonArray)?.Select(n => (int?)n ?? 0).ToHashSet() ?? [];
        ScheduleSave();
        _positions.ReplaceWith(state);
        foreach (var c in _all) c.IsFavorite = _settings.Favorites.Contains(c.StreamId);
        foreach (var m in _movies) m.Progress = _positions.GetProgress(m.Key);
        foreach (var s in _series) s.Progress = _positions.GetLastEpisode(s.SeriesId) != null ? 0.5 : 0;
        if (Mode == LibraryMode.Live)
        {
            if (Categories.FirstOrDefault(c => c.IsFavorites) is { } fav) fav.Count = _all.Count(c => c.IsFavorite);
            if (SelectedCategory?.IsFavorites == true) ApplyFilter();
        }
        else RefreshContinueCount();
    }

    /// <summary>
    /// Collega il server di casa: accede (o crea l'account), porta sul server l'account IPTV di questo PC se lì
    /// manca, unisce preferiti e posizioni di qui a quelli del server, poi usa il server come server Xtream.
    /// Se qualcosa va storto il programma resta com'era.
    /// </summary>
    public async Task ConnectServerAsync(string password)
    {
        var url = ServerApi.NormalizeUrl(ServerAddress);
        if (url.Length == 0 || string.IsNullOrWhiteSpace(ServerUser) || string.IsNullOrEmpty(password))
        {
            ServerError = "Inserisci indirizzo del server, nome utente e password.";
            return;
        }
        ServerBusy = true;
        ServerError = null;
        string? token = null;
        try
        {
            var login = await ServerApi.LoginAsync(url, ServerUser.Trim(), password, ServerRegister, ServerInvite.Trim());
            token = login.Token;
            var ownPassword = IsHomeServer ? null : (_settings.HasAccount ? SettingsService.Unprotect(_settings.ProtectedPassword) : null);
            if (!login.HasXtream)
            {
                if (ownPassword == null)
                    throw new ServerException("Questo account non ha ancora un account IPTV: aggiungilo da IPTVISION nel browser, poi riprova.");
                await ServerApi.SendXtreamAsync(url, token, new XtreamAccount(_settings.Server!, _settings.Username!, ownPassword));
            }
            var mine = _positions.ToServerJson();
            mine["favorites"] = new JsonArray(_settings.Favorites.Select(f => (JsonNode)f).ToArray());
            // Le liste salvate su questo PC si aggiungono a quelle del server.
            if (!IsHomeServer)
                mine["lists"] = new JsonArray(_settings.Lists.Select(l => (JsonNode)new JsonObject
                {
                    ["alias"] = l.Alias, ["server"] = l.Server, ["username"] = l.Username,
                    ["password"] = SettingsService.Unprotect(l.ProtectedPassword) ?? "", ["expiresAt"] = l.ExpiresAt?.ToUnixTimeSeconds(),
                }).ToArray());
            var state = await ServerApi.ImportNativeAsync(url, token, mine);

            if (_settings.HomeServer is { } old) await ServerApi.LogoutAsync(old, SettingsService.Unprotect(_settings.ProtectedPassword) ?? "");
            else
            {
                _settings.OwnServer = _settings.Server;
                _settings.OwnUsername = _settings.Username;
                _settings.OwnProtectedPassword = _settings.ProtectedPassword;
            }
            ResetSession();
            _pendingOps.Clear();
            _settings.Server = url;
            _settings.Username = login.Username;
            _settings.ProtectedPassword = SettingsService.Protect(login.Token);
            _settings.HomeServer = url;
            ApplyServerState(state);
            SettingsService.Save(_settings);
            NotifyServer();
            IsServerLogin = false;
            ServerStatus = "Canali, film e serie passano dal server.";
            _ = LoadServerNetworkAsync();
            await InitializeAsync();
        }
        catch (Exception ex) when (ex is ServerException or XtreamException)
        {
            if (token != null && SettingsService.Unprotect(_settings.ProtectedPassword) != token) await ServerApi.LogoutAsync(url, token);
            ServerError = ex.Message;
        }
        finally
        {
            ServerBusy = false;
        }
    }

    /// <summary>Torna all'account IPTV di prima, direttamente dal provider. Preferiti e posizioni restano quelli di adesso.</summary>
    [RelayCommand]
    private async Task DisconnectServer()
    {
        if (_settings.HomeServer is not { } url) return;
        var token = SettingsService.Unprotect(_settings.ProtectedPassword) ?? "";
        _pendingOps.Clear();
        RestoreOwnAccount();
        ResetSession();
        // ResetSession dimentica la password: quella di prima torna al suo posto.
        RestoreOwnPassword();
        _ = ServerApi.LogoutAsync(url, token);
        ServerStatus = null;
        ServerNetwork = null;
        if (_settings.HasAccount) await InitializeAsync();
    }

    private string? _restoredPassword;

    private void RestoreOwnAccount()
    {
        _settings.Server = _settings.OwnServer;
        _settings.Username = _settings.OwnUsername;
        _restoredPassword = _settings.OwnProtectedPassword;
        _settings.OwnServer = _settings.OwnUsername = _settings.OwnProtectedPassword = null;
        _settings.HomeServer = null;
        _settings.HomeRevision = -1;
        _settings.LastStreamId = null;
        LoginServer = _settings.Server ?? "";
        LoginUsername = _settings.Username ?? "";
        NotifyServer();
    }

    private void RestoreOwnPassword()
    {
        _settings.ProtectedPassword = _restoredPassword;
        _restoredPassword = null;
        SettingsService.Save(_settings);
    }

    [RelayCommand]
    private void ToggleServerLogin()
    {
        IsServerLogin = !IsServerLogin;
        ServerError = null;
        LoginError = null;
    }
}
