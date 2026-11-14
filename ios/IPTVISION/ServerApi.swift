import Foundation
import UIKit

/// "Server di casa": IPTVISION installato su CasaOS (la versione web) fa da server Xtream per l'app.
/// Collegata al server, l'app usa come server Xtream l'indirizzo di casa, come utente l'account
/// del server e come password il gettone di questo dispositivo: liste, guida e flussi passano da casa
/// e l'account IPTV vero resta solo sul server. Preferiti, posizioni e "Continua a guardare" sono
/// quelli dell'account, uguali su ogni dispositivo.
struct ServerError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum ServerApi {
    /// Porta di IPTVISION su CasaOS quando nell'indirizzo non c'è.
    static let defaultPort = 8765

    /// I reindirizzamenti non si seguono: vuol dire http/https sbagliato, e va detto all'utente.
    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        c.httpAdditionalHeaders = ["User-Agent": XtreamClient.userAgent]
        return URLSession(configuration: c, delegate: NoRedirect(), delegateQueue: nil)
    }()

    /// "192.168.1.10" → "http://192.168.1.10:8765"; con http/https o con la porta resta com'è, senza "/" finale.
    static func normalizeUrl(_ input: String) -> String {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.isEmpty { return s }
        let lower = s.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") {
            let host = s.split(separator: "/", maxSplits: 1).first.map(String.init) ?? s
            s = "http://" + (host.contains(":") ? s : host + ":\(defaultPort)" + s.dropFirst(host.count))
        }
        return s
    }

    static var deviceName: String { String("IPTVISION iOS · \(UIDevice.current.model)".prefix(80)) }

    struct Login { let username: String; let token: String; let hasXtream: Bool }

    static func login(_ url: String, username: String, password: String, register: Bool, invite: String) async throws -> Login {
        let o = try await call(url, "POST", "/api/device/login", nil,
                               ["username": username, "password": password, "device": deviceName, "register": register, "invite": invite])
        guard let user = o["username"] as? String, let token = o["token"] as? String else { throw ServerError(message: "Risposta del server non valida.") }
        return Login(username: user, token: token, hasXtream: o["hasXtream"] as? Bool ?? false)
    }

    /// Porta sul server un account IPTV (quello di questo dispositivo, o una lista nuova).
    static func sendXtream(_ url: String, token: String, account: Account, alias: String = "") async throws {
        _ = try await call(url, "POST", "/api/xtream", token,
                           ["server": account.server, "username": account.username, "password": account.password, "alias": alias])
    }

    /// Le liste IPTV del server, senza password.
    static func lists(_ url: String, token: String) async throws -> [SavedList] {
        let o = try await call(url, "GET", "/api/xtream/lists", token, nil)
        return (o["list"] as? [[String: Any]] ?? []).map {
            SavedList(alias: $0["alias"] as? String ?? "", server: $0["server"] as? String ?? "", username: $0["username"] as? String ?? "",
                      password: "", expiresAt: XtreamClient.int($0["expiresAt"]), index: XtreamClient.int($0["index"]), active: $0["active"] as? Bool ?? false)
        }
    }

    /// Il server passa alla lista [index]; torna lo stato (preferiti e posizioni).
    static func useList(_ url: String, token: String, index: Int) async throws -> [String: Any] {
        try await call(url, "POST", "/api/xtream/lists/\(index)/use", token, [:])
    }

    static func removeList(_ url: String, token: String, index: Int) async throws {
        _ = try await call(url, "DELETE", "/api/xtream/lists/\(index)", token, nil)
    }

    static func importNative(_ url: String, token: String, data: [String: Any]) async throws -> [String: Any] {
        try await call(url, "POST", "/api/import-native", token, data)
    }

    /// Preferiti e posizioni; nil se il server ha già la revisione [since].
    static func state(_ url: String, token: String, since: Int?) async throws -> [String: Any]? {
        let o = try await call(url, "GET", "/api/state" + (since.map { "?since=\($0)" } ?? ""), token, nil)
        return o["unchanged"] as? Bool == true ? nil : o
    }

    static func ops(_ url: String, token: String, ops: [[String: Any]]) async throws -> [String: Any] {
        try await call(url, "POST", "/api/ops", token, ["ops": ops])
    }

    /// Come esce su Internet il server di casa: "label" è già pronto da mostrare.
    static func network(_ url: String, token: String) async throws -> [String: Any] {
        try await call(url, "GET", "/api/network", token, nil)
    }

    static func logout(_ url: String, token: String) async {
        _ = try? await call(url, "POST", "/api/logout", token, [:])
    }

    private static func call(_ url: String, _ method: String, _ path: String, _ token: String?, _ body: [String: Any]?) async throws -> [String: Any] {
        guard let u = URL(string: url + path) else { throw ServerError(message: "Indirizzo non valido.") }
        var req = URLRequest(url: u)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let result: (Data, URLResponse)
        do {
            result = try await session.data(for: req)
        } catch let e as URLError {
            switch e.code {
            case .cannotFindHost, .dnsLookupFailed: throw ServerError(message: "Server non trovato: controlla l'indirizzo.")
            case .timedOut: throw ServerError(message: "Il server non risponde: riprova tra poco.")
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid:
                throw ServerError(message: "Connessione sicura non riuscita: con l'indirizzo IP di casa usa http://, non https://.")
            case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
                throw ServerError(message: "Server non raggiungibile: controlla indirizzo, porta e che il dispositivo sia nella stessa rete (o su Tailscale).")
            default: throw ServerError(message: "Server non raggiungibile: \(e.localizedDescription)")
            }
        }
        let (data, resp) = result
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if (300...399).contains(code) { throw ServerError(message: "Il server risponde con un reindirizzamento: controlla se l'indirizzo è http o https.") }
        if code == 401 && token != nil { throw ServerError(message: "Sessione del server scaduta: ricollega il server dalle impostazioni.") }
        // Le risposte che sono un elenco arrivano dentro "list".
        let parsed: Any? = data.isEmpty ? [String: Any]() : (try? JSONSerialization.jsonObject(with: data))
        let o: [String: Any]
        if let a = parsed as? [Any] { o = ["list": a] }
        else if let d = parsed as? [String: Any] { o = d }
        else { throw ServerError(message: "A questo indirizzo non risponde IPTVISION. Controlla indirizzo e porta.") }
        if !(200...299).contains(code) { throw ServerError(message: (o["error"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Errore del server (\(code)).") }
        return o
    }
}
