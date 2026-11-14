import Foundation

struct XtreamError: LocalizedError {
    let message: String
    var isAuthError = false
    var errorDescription: String? { message }
}

struct Account: Codable, Hashable {
    let server: String
    let username: String
    let password: String

    /// Nome dei file in cache per questo account.
    var key: String {
        let s = server.lowercased() + "|" + username
        var h: UInt64 = 1469598103934665603 // FNV-1a: stabile tra un avvio e l'altro, a differenza di hashValue
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return String(h, radix: 16)
    }
}

/// Client per le API "player_api.php" dei pannelli Xtream Codes.
struct XtreamClient {
    static let userAgent = "IPTVISION/1.0"
    let account: Account

    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        c.httpAdditionalHeaders = ["User-Agent": userAgent]
        return URLSession(configuration: c)
    }()

    /// Accetta "host:porta", "http://host:porta/" o l'intero link M3U (get.php?username=..&password=..).
    static func parseServerInput(_ input: String) -> (server: String, user: String?, pass: String?) {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return ("", nil, nil) }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "http://" + s }
        guard let c = URLComponents(string: s), let scheme = c.scheme, let host = c.host else {
            return (s.trimmingCharacters(in: CharacterSet(charactersIn: "/")), nil, nil)
        }
        let items = c.queryItems ?? []
        let user = items.first { $0.name.lowercased() == "username" }?.value
        let pass = items.first { $0.name.lowercased() == "password" }?.value
        // Rimuove get.php / player_api.php dal percorso, tiene eventuali sottocartelle.
        var path = c.percentEncodedPath
        if let last = path.lastIndex(of: "/"), path[path.index(after: last)...].lowercased().hasSuffix(".php") { path = String(path[..<last]) }
        var server = "\(scheme)://\(host)\(c.port.map { ":\($0)" } ?? "")\(path)"
        while server.hasSuffix("/") { server.removeLast() }
        return (server, user, pass)
    }

    private static func q(_ v: String) -> String {
        v.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? v
    }

    private func apiUrl(_ action: String?, _ extra: String? = nil) -> URL {
        var s = "\(account.server)/player_api.php?username=\(Self.q(account.username))&password=\(Self.q(account.password))"
        if let action { s += "&action=\(action)" }
        if let extra { s += "&\(extra)" }
        return URL(string: s)!
    }

    func liveUrl(_ id: Int, ext: String) -> URL { URL(string: "\(account.server)/live/\(Self.q(account.username))/\(Self.q(account.password))/\(id).\(ext)")! }
    func movieUrl(_ m: Movie) -> URL { URL(string: "\(account.server)/movie/\(Self.q(account.username))/\(Self.q(account.password))/\(m.streamId).\(m.ext)")! }
    func episodeUrl(_ e: Episode) -> URL { URL(string: "\(account.server)/series/\(Self.q(account.username))/\(Self.q(account.password))/\(Self.q(e.id)).\(e.ext)")! }

    // MARK: - Richieste

    func authenticate() async throws -> AuthInfo {
        let root = try await json(apiUrl(nil), timeout: 15)
        guard let ui = (root as? [String: Any])?["user_info"] as? [String: Any] else {
            throw XtreamError(message: "Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.")
        }
        if Self.int(ui["auth"]) != 1 {
            throw XtreamError(message: Self.nn(Self.str(ui["message"])) ?? "Nome utente o password non corretti.", isAuthError: true)
        }
        let status = Self.str(ui["status"])
        if let status, status.lowercased() != "active" { throw XtreamError(message: "Account non attivo (stato: \(status)).", isAuthError: true) }
        let exp = Self.int(ui["exp_date"]).flatMap { $0 > 0 ? $0 : nil }
        return AuthInfo(status: status, expiresAt: exp)
    }

    /// Scarica una lista (canali, film, serie, categorie) e la tiene in [file] per gli avvii successivi.
    func download(_ action: String, to file: URL) async throws {
        let data = try await get(apiUrl(action), timeout: 300)
        try data.write(to: file, options: .atomic)
    }

    func vodInfo(_ id: Int) async throws -> VodInfo? {
        guard let root = try await json(apiUrl("get_vod_info", "vod_id=\(id)"), timeout: 20) as? [String: Any],
              let info = root["info"] as? [String: Any] else { return nil }
        let secs = Self.int(info["duration_secs"]) ?? 0
        let video = info["video"] as? [String: Any]
        let w = Self.int(video?["width"]) ?? 0, h = Self.int(video?["height"]) ?? 0
        let res: String? = h >= 2000 || w >= 3800 ? "4K" : h >= 1000 || w >= 1900 ? "1080p" : h >= 700 || w >= 1260 ? "720p" : h > 0 ? "\(h)p" : nil
        return VodInfo(
            plot: Self.nn(Self.str(info["plot"]) ?? Self.str(info["description"])),
            genre: Self.nn(Self.str(info["genre"])),
            year: Self.year(Self.str(info["year"]), Self.str(info["releasedate"]), ""),
            duration: secs > 0 ? Self.duration(secs) : Self.nn(Self.str(info["duration"])),
            director: Self.nn(Self.str(info["director"])),
            cast: Self.nn(Self.str(info["cast"]) ?? Self.str(info["actors"])),
            resolution: res
        )
    }

    func seriesInfo(_ id: Int) async throws -> SeriesInfo {
        let root = try await json(apiUrl("get_series_info", "series_id=\(id)"), timeout: 30) as? [String: Any] ?? [:]
        // Alcuni pannelli restituiscono { "1": [...], "2": [...] }, altri [[...], [...]].
        var groups: [[Any]] = []
        if let o = root["episodes"] as? [String: Any] { groups = o.values.compactMap { $0 as? [Any] } }
        else if let a = root["episodes"] as? [Any] { groups = a.compactMap { $0 as? [Any] } }
        var eps: [Episode] = []
        for g in groups {
            for case let e as [String: Any] in g {
                guard let eid = Self.nn(Self.str(e["id"])) else { continue }
                let info = e["info"] as? [String: Any]
                eps.append(Episode(
                    id: eid, seriesId: id,
                    season: Self.int(e["season"]) ?? 1,
                    number: Self.int(e["episode_num"]) ?? 0,
                    title: (Self.str(e["title"]) ?? "").trimmingCharacters(in: .whitespaces),
                    ext: Self.nn(Self.str(e["container_extension"])) ?? "mp4",
                    durationSecs: Self.int(info?["duration_secs"]) ?? 0,
                    plot: Self.nn(Self.str(info?["plot"])),
                    image: Self.nn(Self.str(info?["movie_image"]))
                ))
            }
        }
        let si = root["info"] as? [String: Any]
        return SeriesInfo(
            plot: Self.nn(Self.str(si?["plot"])),
            genre: Self.nn(Self.str(si?["genre"])),
            year: Self.year(Self.str(si?["year"]), Self.str(si?["releaseDate"]) ?? Self.str(si?["release_date"]), ""),
            cast: Self.nn(Self.str(si?["cast"])),
            episodes: eps.sorted { ($0.season, $0.number) < ($1.season, $1.number) }
        )
    }

    /// Guida breve di un canale: programma in onda e successivi.
    func shortEpg(_ streamId: Int) async throws -> [Programme] {
        let root = try await json(apiUrl("get_short_epg", "stream_id=\(streamId)&limit=6"), timeout: 15) as? [String: Any]
        let list = root?["epg_listings"] as? [[String: Any]] ?? []
        return list.compactMap { e in
            guard let st = Self.int(e["start_timestamp"]), let sp = Self.int(e["stop_timestamp"]) else { return nil }
            return Programme(start: st, stop: sp, title: Self.b64(Self.str(e["title"])) ?? "", description: Self.b64(Self.str(e["description"])))
        }.sorted { $0.start < $1.start }
    }

    // MARK: - Rete

    private func json(_ url: URL, timeout: TimeInterval) async throws -> Any {
        let data = try await get(url, timeout: timeout)
        do { return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
        catch { throw XtreamError(message: "Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.") }
    }

    private func get(_ url: URL, timeout: TimeInterval) async throws -> Data {
        var last: Error?
        for attempt in 0..<3 {
            do {
                var req = URLRequest(url: url)
                req.timeoutInterval = timeout
                let (data, resp) = try await Self.session.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 200
                if code == 401 || code == 403 { throw XtreamError(message: "Accesso negato dal server (credenziali errate o account scaduto).", isAuthError: true) }
                if !(200...299).contains(code) { throw URLError(.badServerResponse) }
                return data
            } catch let e as XtreamError {
                throw e
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                last = error
                if attempt < 2 { try await Task.sleep(nanoseconds: UInt64(500_000_000 * (attempt + 1))) }
            }
        }
        throw XtreamError(message: "Impossibile contattare il server. Controlla la connessione. (\(last?.localizedDescription ?? ""))")
    }

    // MARK: - Lettura delle liste

    private static func array(_ file: URL) throws -> [[String: Any]] {
        let data = try Data(contentsOf: file)
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    static func parseCategories(_ file: URL) throws -> [Category] {
        try array(file).compactMap { m in
            guard let id = str(m["category_id"]) else { return nil }
            return Category(id: id, name: str(m["category_name"])?.trimmingCharacters(in: .whitespaces) ?? id)
        }
    }

    static func parseChannels(_ file: URL) throws -> [Channel] {
        try array(file).compactMap { m in
            guard let id = int(m["stream_id"]) else { return nil }
            let name = (str(m["name"]) ?? "Canale \(id)").trimmingCharacters(in: .whitespaces)
            return Channel(streamId: id, num: int(m["num"]) ?? 0, name: name, logo: nn(str(m["stream_icon"])),
                           categoryId: str(m["category_id"]), epgId: nn(str(m["epg_channel_id"])), searchKey: TextHelpers.normalize(name))
        }
    }

    static func parseMovies(_ file: URL) throws -> [Movie] {
        try array(file).compactMap { m in
            guard let id = int(m["stream_id"]) else { return nil }
            let name = (str(m["name"]) ?? "Film \(id)").trimmingCharacters(in: .whitespaces)
            return Movie(streamId: id, name: name, poster: nn(str(m["stream_icon"])), categoryId: str(m["category_id"]),
                         ext: nn(str(m["container_extension"])) ?? "mp4",
                         year: year(str(m["year"]), str(m["releasedate"]), name), rating: rating(m),
                         added: int(m["added"]) ?? 0, searchKey: TextHelpers.normalize(name), variantKey: TextHelpers.variantKey(name))
        }
    }

    static func parseSeries(_ file: URL) throws -> [Series] {
        try array(file).compactMap { m in
            guard let id = int(m["series_id"]) else { return nil }
            let name = (str(m["name"]) ?? "Serie \(id)").trimmingCharacters(in: .whitespaces)
            return Series(seriesId: id, name: name, cover: nn(str(m["cover"])), categoryId: str(m["category_id"]),
                          year: year(str(m["year"]), str(m["releaseDate"]) ?? str(m["release_date"]), name), rating: rating(m),
                          plot: nn(str(m["plot"])), genre: nn(str(m["genre"])),
                          searchKey: TextHelpers.normalize(name), variantKey: TextHelpers.variantKey(name))
        }
    }

    // MARK: - Valori: i pannelli mandano numeri a volte come testo, a volte come numero

    static func str(_ v: Any?) -> String? {
        switch v {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }

    static func int(_ v: Any?) -> Int? {
        guard let s = str(v)?.trimmingCharacters(in: .whitespaces) else { return nil }
        return Int(s) ?? Double(s).map { Int($0) }
    }

    static func nn(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    private static func year(_ year: String?, _ date: String?, _ name: String) -> String? {
        for s in [year, date] {
            if let t = s?.trimmingCharacters(in: .whitespaces), t.count >= 4, let y = Int(t.prefix(4)), y > 1880 { return String(y) }
        }
        guard let r = name.range(of: #"\((19|20)\d{2}\)"#, options: .regularExpression) else { return nil }
        return String(name[r].dropFirst().dropLast())
    }

    private static func rating(_ m: [String: Any]) -> Double {
        if let r = str(m["rating"]).flatMap(Double.init), r > 0 { return min(r, 10) }
        if let r = str(m["rating_5based"]).flatMap(Double.init), r > 0 { return min(r * 2, 10) }
        return 0
    }

    private static func duration(_ secs: Int) -> String {
        let h = secs / 3600, m = (secs % 3600) / 60
        return h > 0 ? "\(h) h \(String(format: "%02d", m)) min" : "\(m) min"
    }

    private static func b64(_ s: String?) -> String? {
        guard let s, !s.isEmpty, let d = Data(base64Encoded: s, options: .ignoreUnknownCharacters), let t = String(data: d, encoding: .utf8) else { return s }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
