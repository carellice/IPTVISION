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
    /// Le altre qualità dello stesso canale ("Rai 1 HD", "Rai 1 4K"): si provano se il flusso si interrompe.
    var alternates: [Int] = []
    /// qualityRank di ogni versione: prima questa, poi gli alternates.
    var ranks: [Int] = []

    var id: Int { streamId }
    var initials: String { TextHelpers.initials(name) }
}

/// Lo stesso canale in più qualità ("Rai 1 FHD", "Rai 1 HD", "Rai 1 4K") diventa uno solo, "Rai 1", dentro la sua
/// categoria. Resta in testa la versione nei preferiti, altrimenti la prima della lista.
/// Elenco unico (single): lo stesso canale si unisce anche tra categorie diverse e parte dalla qualità migliore;
/// se il flusso si interrompe il player gira sulle altre, dalla migliore alla peggiore.
func groupChannels(_ items: [Channel], favorites: Set<Int>, single: Bool = false) -> [Channel] {
    var groups: [String: [Channel]] = [:]
    var order: [String] = []
    for c in items {
        let k = (single ? "" : c.categoryId ?? "") + "|" + TextHelpers.channelKey(c.name)
        if groups[k] == nil { order.append(k) }
        groups[k, default: []].append(c)
    }
    return order.map { k in
        var g = groups[k]!
        if single {
            // Ordinamento stabile: a parità di qualità resta l'ordine del provider.
            g = g.enumerated().sorted { a, b in
                let (ra, rb) = (TextHelpers.qualityRank(a.element.name), TextHelpers.qualityRank(b.element.name))
                return ra != rb ? ra > rb : a.offset < b.offset
            }.map(\.element)
        }
        if g.count == 1 { return g[0] }
        let main = single ? g[0] : g.first { favorites.contains($0.streamId) } ?? g[0]
        let name = TextHelpers.withoutQuality(main.name)
        return Channel(streamId: main.streamId, num: main.num, name: name, logo: main.logo ?? g.compactMap(\.logo).first,
                       categoryId: main.categoryId, epgId: main.epgId ?? g.compactMap(\.epgId).first,
                       searchKey: TextHelpers.normalize(name), alternates: g.filter { $0.streamId != main.streamId }.map(\.streamId),
                       ranks: ([main] + g.filter { $0.streamId != main.streamId }).map { TextHelpers.qualityRank($0.name) })
    }
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

    // Solo le sigle di qualità video: lingua e audio diversi restano canali separati.
    private static let channelQualityTags: Set<String> = [
        "4k", "uhd", "2160p", "fhd", "full", "1080p", "1080i", "hd", "720p", "sd", "576p", "576i", "480p",
        "hdr", "hevc", "h265", "h264", "50fps", "60fps", "hq", "lq",
    ]

    /// Chiave per riconoscere lo stesso canale in qualità diverse: nome normalizzato senza sigle di qualità.
    static func channelKey(_ name: String) -> String {
        let n = normalize(name)
        let words = n.split(separator: " ").filter { !channelQualityTags.contains(String($0)) }
        return words.isEmpty ? n : words.joined(separator: " ")
    }

    /// Qualità dal nome, per provare prima la migliore: 4K 4, FHD 3, HD 2, senza sigla 1, SD 0.
    static func qualityRank(_ name: String) -> Int {
        let words = Set(normalize(name).split(separator: " ").map(String.init))
        func has(_ tags: String...) -> Bool { tags.contains { words.contains($0) } }
        if has("4k", "uhd", "2160p") { return 4 }
        if has("fhd", "full", "1080p", "1080i") { return 3 }
        if has("hd", "720p") { return 2 }
        if has("sd", "576p", "576i", "480p") { return 0 }
        return 1
    }

    /// Mb/s che serve a ogni qualità per non bloccarsi, per qualityRank: SD, senza sigla, HD, FHD, 4K.
    private static let qualityMbps: [Double] = [2, 4, 5, 9, 25]
    static let qualityLabels = ["SD", "qualità standard", "HD", "FHD", "4K"]

    /// La versione da cui partire con mbps di velocità: la qualità migliore che regge, se no la più bassa.
    static func pickBySpeed(_ ranks: [Int], mbps: Double) -> Int {
        let fits = ranks.indices.filter { qualityMbps[ranks[$0]] <= mbps }
        return fits.max { ranks[$0] < ranks[$1] } ?? ranks.indices.min { ranks[$0] < ranks[$1] } ?? 0
    }

    /// "Rai 1 FHD" → "Rai 1": il nome da mostrare per un canale raggruppato.
    static func withoutQuality(_ name: String) -> String {
        let words = name.split(separator: " ").filter { w in
            let n = normalize(String(w))
            return n.isEmpty || !channelQualityTags.contains(n)
        }
        var s = words.joined(separator: " ")
        while let last = s.last, " |-:([".contains(last) { s.removeLast() }
        return s.isEmpty ? name : s
    }

    /// Le sigle di qualità presenti nel titolo, per distinguere le versioni ("4K HDR", "FHD").
    static func quality(of name: String) -> String? {
        var seen: [String] = []
        for w in normalize(name).split(separator: " ").map(String.init) where qualityTags.contains(w) && !seen.contains(w) { seen.append(w) }
        return seen.isEmpty ? nil : seen.map { $0.uppercased() }.joined(separator: " ")
    }
}
