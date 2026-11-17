import Foundation

/// TMDB (themoviedb.org): copertine, tendenze e generi per la schermata "Film e serie".
/// Il catalogo resta quello del provider: TMDB sceglie e veste solo i titoli che ci sono.
/// Stessa logica di PWA/web/src/lib/tmdb.ts.
enum Tmdb {
    enum Kind: String, Hashable, Codable { case movie, tv }

    struct Card: Hashable, Codable {
        let id: Int
        let kind: Kind
        let title: String
        let year: String?
        let overview: String
        let poster: String?
        let backdrop: String?
        let vote: Double
        let keys: [String]
    }

    struct Row: Identifiable, Codable {
        let id: String
        let title: String
        let items: [Card]
        let top: Bool
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func img(_ path: String?, _ size: String = "w342") -> String? { path.map { "https://image.tmdb.org/t/p/\(size)\($0)" } }

    private static let years = try! NSRegularExpression(pattern: "\\b(19|20)\\d\\d\\b")

    /// Lo stesso titolo, qualunque cosa abbia aggiunto il pannello: prefisso di lingua, sigle di qualità, anno.
    static func matchKey(_ name: String) -> String {
        let k = TextHelpers.variantKey(name)
        let noYear = years.stringByReplacingMatches(in: k, range: NSRange(k.startIndex..., in: k), withTemplate: " ")
        return noYear.split(separator: " ").joined(separator: " ")
    }

    // MARK: - Richieste

    // shortcut: risposte tenute solo in memoria (a ogni avvio ~60 richieste), usare un file se TMDB inizia a limitare.
    private actor Store {
        var cache: [String: [String: Any]] = [:]
        var running = 0
        var waiting: [CheckedContinuation<Void, Never>] = []

        func cached(_ url: String) -> [String: Any]? { cache[url] }
        func put(_ url: String, _ v: [String: Any]) { cache[url] = v }
        func clear() { cache = [:] }

        /// Al massimo 6 richieste insieme: la schermata ne chiede ~60 e TMDB risponde 429 alle raffiche.
        func acquire() async {
            if running < 6 { running += 1; return }
            await withCheckedContinuation { waiting.append($0) }
        }

        func release() {
            if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
        }
    }

    private static let store = Store()

    static func clearCache() async { await store.clear() }

    private static func get(_ key: String, _ path: String, _ params: [String: String] = [:]) async throws -> [String: Any] {
        // I token v4 sono JWT ("eyJ..."), le chiavi v3 sono 32 caratteri esadecimali.
        let bearer = key.hasPrefix("eyJ")
        var c = URLComponents(string: "https://api.themoviedb.org/3/\(path)")!
        var q = [URLQueryItem(name: "language", value: "it-IT")] + params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        if !bearer { q.append(URLQueryItem(name: "api_key", value: key)) }
        c.queryItems = q
        let url = c.url!
        if let hit = await store.cached(url.absoluteString) { return hit }
        var req = URLRequest(url: url, timeoutInterval: 20)
        if bearer { req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        var tries = 3
        while true {
            await store.acquire()
            let answer: (Data, URLResponse)
            do { answer = try await URLSession.shared.data(for: req) } catch {
                await store.release()
                throw Failure(message: "TMDB non raggiungibile.")
            }
            await store.release()
            let code = (answer.1 as? HTTPURLResponse)?.statusCode ?? 0
            // Troppe richieste insieme: si aspetta quanto dice TMDB (o un secondo) e si riprova.
            if code == 429 && tries > 0 {
                tries -= 1
                let wait = Double((answer.1 as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 1
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                continue
            }
            if code == 401 { throw Failure(message: "Chiave TMDB non valida.") }
            guard (200..<300).contains(code), let o = try? JSONSerialization.jsonObject(with: answer.0) as? [String: Any] else {
                throw Failure(message: "TMDB: errore \(code)")
            }
            await store.put(url.absoluteString, o)
            return o
        }
    }

    /// Lancia l'errore col motivo se la chiave non funziona.
    static func check(_ key: String) async throws { _ = try await get(key.trimmingCharacters(in: .whitespaces), "configuration") }

    private static func card(_ o: [String: Any], _ kind: Kind?) -> Card? {
        let k: Kind
        if let kind { k = kind } else if o["media_type"] as? String == "movie" { k = .movie } else if o["media_type"] as? String == "tv" { k = .tv } else { return nil }
        guard let id = o["id"] as? Int else { return nil }
        func s(_ n: String) -> String { (o[n] as? String) ?? "" }
        let title = s("title").isEmpty ? s("name") : s("title")
        let original = s("original_title").isEmpty ? s("original_name") : s("original_title")
        let date = s("release_date").isEmpty ? s("first_air_date") : s("release_date")
        var keys: [String] = []
        for x in [matchKey(title), matchKey(original)] where !x.isEmpty && !keys.contains(x) { keys.append(x) }
        return Card(id: id, kind: k, title: title, year: date.count >= 4 ? String(date.prefix(4)) : nil, overview: s("overview"),
                    poster: (o["poster_path"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                    backdrop: (o["backdrop_path"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                    vote: (o["vote_average"] as? Double) ?? Double(o["vote_average"] as? Int ?? 0), keys: keys)
    }

    private static func cards(_ page: [String: Any], _ kind: Kind?) -> [Card] {
        ((page["results"] as? [[String: Any]]) ?? []).compactMap { card($0, kind) }
    }

    // MARK: - Le righe della schermata

    private struct Source { let kind: Kind; let path: String; let params: [String: String] }

    private static func pages(_ kind: Kind, _ path: String, _ n: Int, _ params: [String: String] = [:]) -> [Source] {
        (1...n).map { p in Source(kind: kind, path: path, params: params.merging(["page": "\(p)"]) { $1 }) }
    }

    private static func discover(_ kind: Kind, _ genre: Int) -> [Source] {
        pages(kind, kind == .movie ? "discover/movie" : "discover/tv", 2,
              ["with_genres": "\(genre)", "sort_by": "popularity.desc", "vote_count.gte": kind == .movie ? "150" : "60"])
    }

    /// Titolo, genere dei film, genere delle serie (TMDB ha due elenchi di generi diversi).
    private static let genres: [(String, Int?, Int?)] = [
        ("Azione e avventura", 28, 10759), ("Commedie", 35, 35), ("Fantascienza e fantasy", 878, 10765), ("Crime", 80, 80),
        ("Thriller e mistero", 53, 9648), ("Drammi", 18, 18), ("Animazione", 16, 16), ("Horror", 27, nil),
        ("Romantici", 10749, nil), ("Per tutta la famiglia", 10751, 10751), ("Documentari", 99, 99),
    ]

    private static let defs: [(id: String, title: String, top: Bool, sources: [Source])] = [
        ("top", "Top 10 di oggi", true, pages(.movie, "trending/all/day", 3)),
        ("trend", "Di tendenza questa settimana", false, pages(.movie, "trending/all/week", 3)),
        ("popm", "Film popolari", false, pages(.movie, "movie/popular", 3)),
        ("popt", "Serie TV popolari", false, pages(.tv, "tv/popular", 3)),
        ("best", "I più acclamati", false, pages(.movie, "movie/top_rated", 3) + pages(.tv, "tv/top_rated", 3)),
    ] + genres.map { g -> (id: String, title: String, top: Bool, sources: [Source]) in
        ("g:\(g.0)", g.0, false, (g.1.map { discover(.movie, $0) } ?? []) + (g.2.map { discover(.tv, $0) } ?? []))
    }

    /// Film e serie affiancati: il primo dell'una, il primo dell'altra e così via.
    private static func interleave(_ a: [Card], _ b: [Card]) -> [Card] {
        var out: [Card] = []
        for i in 0..<max(a.count, b.count) {
            if i < a.count { out.append(a[i]) }
            if i < b.count { out.append(b[i]) }
        }
        return out
    }

    private struct SavedRows: Codable { let day: String; let key: Int; let rows: [Row] }

    /// Le classifiche cambiano una volta al giorno: si scaricano alla prima apertura della giornata, poi si rileggono dal file.
    static func loadRows(_ key: String) async -> [Row] {
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tmdb_rows.json")
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let day = f.string(from: Date())
        let hash = key.unicodeScalars.reduce(7) { ($0 &* 31) &+ Int($1.value) }
        if let data = try? Data(contentsOf: file), let s = try? JSONDecoder().decode(SavedRows.self, from: data), s.day == day, s.key == hash { return s.rows }
        let rows = await downloadRows(key)
        // Solo se TMDB ha risposto: righe vuote (rete assente) non devono restare per tutto il giorno.
        if rows.contains(where: { !$0.items.isEmpty }), let data = try? JSONEncoder().encode(SavedRows(day: day, key: hash, rows: rows)) {
            try? data.write(to: file, options: .atomic)
        }
        return rows
    }

    private static func downloadRows(_ key: String) async -> [Row] {
        await withTaskGroup(of: (Int, Row).self) { group in
            for (n, d) in defs.enumerated() {
                group.addTask {
                    var answers: [[Card]] = []
                    for s in d.sources {
                        // trending/all mescola i due: il tipo arriva con ogni risultato.
                        let page = try? await get(key, s.path, s.params)
                        answers.append(page.map { cards($0, s.path.hasPrefix("trending") ? nil : s.kind) } ?? [])
                    }
                    let trending = d.sources.contains { $0.path.hasPrefix("trending") }
                    let items = trending ? answers.flatMap { $0 } : interleave(
                        zip(d.sources, answers).filter { $0.0.kind == .movie }.flatMap(\.1),
                        zip(d.sources, answers).filter { $0.0.kind == .tv }.flatMap(\.1))
                    return (n, Row(id: d.id, title: d.title, items: items, top: d.top))
                }
            }
            var rows: [(Int, Row)] = []
            for await r in group { rows.append(r) }
            return rows.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    /// La scheda TMDB di un titolo del catalogo (continua a guardare, schede di dettaglio).
    static func lookup(_ key: String, _ kind: Kind, _ name: String, _ year: String?) async -> Card? {
        let query = matchKey(name)
        if query.isEmpty || key.isEmpty { return nil }
        guard let page = try? await get(key, kind == .movie ? "search/movie" : "search/tv", ["query": query]) else { return nil }
        let list = cards(page, kind).filter { $0.keys.contains(query) }
        return list.first { c in year.map { c.year == String($0.prefix(4)) } ?? false } ?? list.first
    }

    /// I remake hanno lo stesso titolo: gli anni devono coincidere (±1) quando ci sono entrambi.
    static func yearsClose(_ a: String?, _ b: String?) -> Bool {
        guard let x = a.flatMap({ Int($0.prefix(4)) }), let y = b.flatMap({ Int($0) }) else { return true }
        return abs(x - y) <= 1
    }
}
