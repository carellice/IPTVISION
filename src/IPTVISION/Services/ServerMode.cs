using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;
using System.Text.Json.Nodes;

namespace IPTVISION.Services;

/// <summary>
/// "Server di casa": IPTVISION installato su CasaOS (la versione web) fa da server Xtream per il programma.
/// Collegato al server, il programma usa come server Xtream l'indirizzo di casa, come utente l'account del
/// server e come password il gettone di questo PC: liste, guida, flussi e download passano da casa e
/// l'account IPTV vero resta solo sul server. Preferiti e posizioni sono quelli dell'account.
/// </summary>
public sealed class ServerException(string message) : Exception(message);

public sealed record ServerLogin(string Username, string Token, bool HasXtream);

public static class ServerApi
{
    /// <summary>Porta di IPTVISION su CasaOS quando nell'indirizzo non c'è.</summary>
    public const int DefaultPort = 8765;

    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromSeconds(30),
    };

    public static string DeviceName => $"IPTVISION Windows · {Environment.MachineName}";

    /// <summary>"192.168.1.10" → "http://192.168.1.10:8765"; con https o con la porta resta com'è, senza "/" finale.</summary>
    public static string NormalizeUrl(string input)
    {
        var s = input.Trim().TrimEnd('/');
        if (s.Length == 0) return s;
        if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return s;
        var slash = s.IndexOf('/');
        var host = slash < 0 ? s : s[..slash];
        var rest = slash < 0 ? "" : s[slash..];
        return host.Contains(':') ? $"http://{s}" : $"http://{host}:{DefaultPort}{rest}";
    }

    public static async Task<ServerLogin> LoginAsync(string url, string username, string password, bool register, string invite)
    {
        var o = await CallAsync(url, HttpMethod.Post, "/api/device/login", null, new JsonObject
        {
            ["username"] = username, ["password"] = password, ["device"] = DeviceName, ["register"] = register, ["invite"] = invite,
        });
        return new ServerLogin((string?)o["username"] ?? username, (string?)o["token"] ?? "", (bool?)o["hasXtream"] ?? false);
    }

    /// <summary>Porta sul server l'account IPTV che c'era su questo PC (se il server non ne ha uno).</summary>
    public static Task SendXtreamAsync(string url, string token, XtreamAccount account, string alias = "") =>
        CallAsync(url, HttpMethod.Post, "/api/xtream", token, new JsonObject
        {
            ["server"] = account.Server, ["username"] = account.Username, ["password"] = account.Password, ["alias"] = alias,
        });

    /// <summary>Le liste IPTV salvate sul server, senza password: index, alias, username, expiresAt, active.</summary>
    public static async Task<JsonArray> ListsAsync(string url, string token) =>
        await SendAsync(url, HttpMethod.Get, "/api/xtream/lists", token, null) as JsonArray ?? [];

    /// <summary>Il server passa alla lista <paramref name="index"/>; torna lo stato (preferiti e posizioni).</summary>
    public static Task<JsonObject> UseListAsync(string url, string token, int index) =>
        CallAsync(url, HttpMethod.Post, $"/api/xtream/lists/{index}/use", token, new JsonObject());

    public static Task RemoveListAsync(string url, string token, int index) =>
        SendAsync(url, HttpMethod.Delete, $"/api/xtream/lists/{index}", token, null);

    public static Task<JsonObject> ImportNativeAsync(string url, string token, JsonObject data) =>
        CallAsync(url, HttpMethod.Post, "/api/import-native", token, data);

    /// <summary>Preferiti e posizioni; null se il server ha già la revisione <paramref name="since"/>.</summary>
    public static async Task<JsonObject?> StateAsync(string url, string token, int? since)
    {
        var o = await CallAsync(url, HttpMethod.Get, "/api/state" + (since is { } s ? $"?since={s}" : ""), token, null);
        return (bool?)o["unchanged"] == true ? null : o;
    }

    public static Task<JsonObject> OpsAsync(string url, string token, JsonArray ops) =>
        CallAsync(url, HttpMethod.Post, "/api/ops", token, new JsonObject { ["ops"] = ops });

    /// <summary>Come esce su Internet il server di casa: "label" pronto da mostrare e "vpn" (true, false o null).</summary>
    public static Task<JsonObject> NetworkAsync(string url, string token) =>
        CallAsync(url, HttpMethod.Get, "/api/network", token, null);

    public static async Task LogoutAsync(string url, string token)
    {
        try { await CallAsync(url, HttpMethod.Post, "/api/logout", token, new JsonObject()); }
        catch (Exception ex) { Log.Write("Scollegamento dal server non riuscito", ex); }
    }

    private static async Task<JsonObject> CallAsync(string url, HttpMethod method, string path, string? token, JsonObject? body) =>
        await SendAsync(url, method, path, token, body) as JsonObject ?? throw new ServerException("A questo indirizzo non risponde IPTVISION. Controlla indirizzo e porta.");

    private static async Task<JsonNode?> SendAsync(string url, HttpMethod method, string path, string? token, JsonObject? body)
    {
        try
        {
            using var req = new HttpRequestMessage(method, url + path);
            if (token != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var resp = await Http.SendAsync(req);
            var text = await resp.Content.ReadAsStringAsync();
            var code = (int)resp.StatusCode;
            if (code is >= 300 and < 400) throw new ServerException("Il server risponde con un reindirizzamento: controlla se l'indirizzo è http o https.");
            if (resp.StatusCode == HttpStatusCode.Unauthorized && token != null)
                throw new ServerException("Sessione del server scaduta: ricollega il server dalle impostazioni.");
            JsonNode o;
            try { o = JsonNode.Parse(text.Length == 0 ? "{}" : text) ?? throw new FormatException(); }
            catch (Exception) { throw new ServerException("A questo indirizzo non risponde IPTVISION. Controlla indirizzo e porta."); }
            if (!resp.IsSuccessStatusCode) throw new ServerException((o as JsonObject)?["error"] is JsonValue e && (string?)e is { Length: > 0 } msg ? msg : $"Errore del server ({code}).");
            return o;
        }
        catch (ServerException) { throw; }
        catch (HttpRequestException ex) when (ex.InnerException is AuthenticationException)
        {
            throw new ServerException("Connessione sicura non riuscita: con l'indirizzo IP di casa usa http://, non https://.");
        }
        catch (HttpRequestException ex) when (ex.InnerException is SocketException { SocketErrorCode: SocketError.HostNotFound })
        {
            throw new ServerException("Server non trovato: controlla l'indirizzo.");
        }
        catch (HttpRequestException)
        {
            throw new ServerException("Server non raggiungibile: controlla indirizzo, porta e che il PC sia nella stessa rete (o su Tailscale).");
        }
        catch (TaskCanceledException)
        {
            throw new ServerException("Il server non risponde: riprova tra poco.");
        }
        catch (UriFormatException)
        {
            throw new ServerException("Indirizzo non valido.");
        }
        catch (InvalidOperationException)
        {
            throw new ServerException("Indirizzo non valido.");
        }
    }
}
