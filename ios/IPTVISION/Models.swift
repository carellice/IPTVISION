import Foundation

struct Category: Identifiable, Hashable {
    let id: String
    let name: String
}

struct Channel: Identifiable, Hashable {
    let streamId: Int
    let num: Int
    let name: String
    let logo: String?
    let categoryId: String?
    let epgId: String?
    let searchKey: String

    var id: Int { streamId }
    var initials: String { TextHelpers.initials(name) }
}

struct Movie: Identifiable, Hashable {
    let streamId: Int
    let name: String
    let poster: String?
    let categoryId: String?
    let ext: String
    let year: String?
    let rating: Double
    let added: Int
    let searchKey: String
    let variantKey: String

    var id: Int { streamId }
    var key: String { "m:\(streamId)" }
    var meta: String { TextHelpers.joinMeta(year, rating > 0 ? String(format: "★ %.1f", rating) : nil) }
}

struct Series: Identifiable, Hashable {
    let seriesId: Int
    let name: String
    let cover: String?
    let categoryId: String?
    let year: String?
    let rating: Double
    let plot: String?
    let genre: String?
    let searchKey: String
    let variantKey: String

    var id: Int { seriesId }
    var key: String { "s:\(seriesId)" }
    var meta: String { TextHelpers.joinMeta(year, genre, rating > 0 ? String(format: "★ %.1f", rating) : nil) }
}

struct Episode: Identifiable, Hashable {
    let id: String
    let seriesId: Int
    let season: Int
    let number: Int
    let title: String
    let ext: String
    let durationSecs: Int
    let plot: String?
    let image: String?

    var key: String { "e:\(id)" }
    var label: String { "S\(season) E\(number)" }
    var displayTitle: String { title.isEmpty ? "Episodio \(number)" : title }
    var durationText: String { durationSecs > 0 ? "\(max(1, Int((Double(durationSecs) / 60).rounded()))) min" : "" }
}

/// Orari in secondi Unix.
struct Programme: Hashable {
    let start: Int
    let stop: Int
    let title: String
    let description: String?

    func progress(at now: Int) -> Double {
        let total = stop - start
        guard total > 0 else { return 0 }
        return min(1, max(0, Double(now - start) / Double(total)))
    }

    var timeRange: String { "\(TextHelpers.clock(start)) – \(TextHelpers.clock(stop))" }
}

struct AuthInfo {
    let status: String?
    let expiresAt: Int?
}

struct VodInfo {
    let plot: String?
    let genre: String?
    let year: String?
    let duration: String?
    let director: String?
    let cast: String?
    let resolution: String?
}

struct SeriesInfo {
    let plot: String?
    let genre: String?
    let year: String?
    let cast: String?
    let episodes: [Episode]
}

/// Un account Xtream salvato con il nome scelto dall'utente; expiresAt in secondi Unix.
/// Con il server di casa: index e active vengono dal server, la password resta lì.
struct SavedList: Codable, Hashable, Identifiable {
    var alias: String
    var server: String
    var username: String
    var password: String
    var expiresAt: Int?
    var index: Int? = nil
    var active: Bool? = nil

    var id: String { "\(index ?? -1)|" + server.lowercased() + "|" + username }
    func isSame(_ a: Account) -> Bool { server.caseInsensitiveCompare(a.server) == .orderedSame && username == a.username }
}

/// Un titolo nelle liste: se è pubblicato più volte (per esempio in FHD e in 4K) raccoglie tutte le versioni.
struct TitleEntry<T: Identifiable & Hashable>: Identifiable, Hashable {
    let item: T
    let variants: [T]
    var id: T.ID { item.id }
    var hasVariants: Bool { variants.count > 1 }
}

/// Raggruppa le copie dello stesso titolo; resta il primo nell'ordine della lista.
func groupVariants<T: Identifiable & Hashable>(_ items: [T], key: (T) -> String) -> [TitleEntry<T>] {
    var order: [String] = []
    var groups: [String: [T]] = [:]
    for it in items {
        let k = key(it)
        if groups[k] == nil { order.append(k) }
        groups[k, default: []].append(it)
    }
    return order.map { let g = groups[$0]!; return TitleEntry(item: g[0], variants: g) }
}

enum TextHelpers {
    /// Minuscolo, senza accenti né punteggiatura: la ricerca non distingue "Città" da "citta".
    static func normalize(_ s: String) -> String {
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        var out = ""
        out.reserveCapacity(folded.count)
        for c in folded {
            if c.isLetter || c.isNumber { out.append(c) }
            else if !out.isEmpty && out.last != " " { out.append(" ") }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    static func initials(_ name: String) -> String {
        let parts = name.split(whereSeparator: { " -_|:".contains($0) }).filter { $0.contains { $0.isLetter || $0.isNumber } }
        if parts.isEmpty { return "TV" }
        if parts.count == 1 { return String(parts[0].filter { $0.isLetter || $0.isNumber }.prefix(2)).uppercased() }
        return parts.prefix(2).map { String($0.first { $0.isLetter || $0.isNumber }!).uppercased() }.joined()
    }

    static func formatTime(_ seconds: Double) -> String {
        let t = max(0, Int(seconds))
        let h = t / 3600, m = (t % 3600) / 60, s = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    static func clock(_ unix: Int) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: TimeInterval(unix)))
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    static func joinMeta(_ parts: String?...) -> String {
        parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "  ·  ")
    }

    // Sigle di qualità, codifica e lingua che i pannelli aggiungono al titolo ("Film (2020) FHD", "Film 4K HDR").
    private static let qualityTags: Set<String> = [
        "4k", "uhd", "2160p", "fhd", "1080p", "1080i", "hd", "720p", "sd", "576p", "480p",
        "hdr", "hdr10", "dv", "hevc", "h265", "x265", "h264", "x264", "10bit",
        "3d", "ita", "eng", "subita", "multisub", "bluray", "bdrip", "webdl", "webrip", "dvdrip",
    ]
    private static let langPrefix = try! NSRegularExpression(pattern: #"^\s*[\[(|]?\s*[A-Z]{2,3}\s*[\])|:\-]\s*"#)

    /// Chiave per riconoscere lo stesso titolo pubblicato più volte: nome senza sigle di qualità e senza prefisso di lingua ("IT | ").
    static func variantKey(_ name: String) -> String {
        let stripped = langPrefix.stringByReplacingMatches(in: name, range: NSRange(name.startIndex..., in: name), withTemplate: "")
        let words = normalize(stripped).split(separator: " ").filter { !qualityTags.contains(String($0)) }
        return words.isEmpty ? normalize(name) : words.joined(separator: " ")
    }

    /// Le sigle di qualità presenti nel titolo, per distinguere le versioni ("4K HDR", "FHD").
    static func quality(of name: String) -> String? {
        var seen: [String] = []
        for w in normalize(name).split(separator: " ").map(String.init) where qualityTags.contains(w) && !seen.contains(w) { seen.append(w) }
        return seen.isEmpty ? nil : seen.map { $0.uppercased() }.joined(separator: " ")
    }
}
