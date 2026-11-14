import Foundation

/// Impostazioni dell'app (UserDefaults: restano nella sandbox dell'app, nessun'altra app le legge).
enum AppSettings {
    private static let d = UserDefaults.standard

    static var account: Account? {
        get { d.data(forKey: "account").flatMap { try? JSONDecoder().decode(Account.self, from: $0) } }
        set { d.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "account") }
    }

    static var lists: [SavedList] {
        get { d.data(forKey: "lists").flatMap { try? JSONDecoder().decode([SavedList].self, from: $0) } ?? [] }
        set { d.set(try? JSONEncoder().encode(newValue), forKey: "lists") }
    }

    static var favorites: Set<Int> {
        get { Set(d.array(forKey: "favorites") as? [Int] ?? []) }
        set { d.set(Array(newValue), forKey: "favorites") }
    }

    /// "ts" (MPEG-TS) oppure "m3u8" (HLS).
    static var outputFormat: String {
        get { d.string(forKey: "outputFormat") ?? "ts" }
        set { d.set(newValue, forKey: "outputFormat") }
    }

    /// Nasconde le categorie con "XXX" nel nome (canali, film e serie).
    static var hideAdult: Bool {
        get { d.bool(forKey: "hideAdult") }
        set { d.set(newValue, forKey: "hideAdult") }
    }

    static func sort(_ section: AppSection) -> ListSort {
        d.string(forKey: "sort_\(section.rawValue)").flatMap(ListSort.init(rawValue:)) ?? .default
    }
    static func setSort(_ section: AppSection, _ v: ListSort) { d.set(v.rawValue, forKey: "sort_\(section.rawValue)") }

    // MARK: Server di casa (IPTVISION su CasaOS)

    /// Indirizzo del server di casa; nil = l'app parla direttamente col provider IPTV.
    /// Collegata al server, `account` ha come server l'indirizzo di casa, come utente l'account del server
    /// e come password il gettone di questo dispositivo.
    static var homeServer: String? {
        get { d.string(forKey: "homeServer") }
        set { d.set(newValue, forKey: "homeServer") }
    }

    /// Ultima revisione di preferiti e posizioni avuta dal server.
    static var homeRevision: Int? {
        get { d.object(forKey: "homeRevision") as? Int }
        set { d.set(newValue, forKey: "homeRevision") }
    }

    /// L'account IPTV di prima del collegamento al server: torna quando lo si scollega.
    static var ownAccount: Account? {
        get { d.data(forKey: "ownAccount").flatMap { try? JSONDecoder().decode(Account.self, from: $0) } }
        set { d.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "ownAccount") }
    }
}

/// Punti di ripresa, titoli visti, ultimo episodio per serie e "La mia lista", in un file JSON.
/// Stesso formato di positions.json di Android e di /api/state del server di casa (tempi in millisecondi).
final class PositionStore {
    private struct Pos: Codable { var p: Double; var d: Double; var u: Double }
    private struct Last: Codable { var id: String; var u: Double }
    private struct File: Codable {
        var positions: [String: Pos] = [:]
        var watched: Set<String> = []
        var lastEpisode: [String: Last] = [:]
        var myList: [String: Double] = [:]

        init() {}
        // Il server manda anche altri campi (revision, favorites...) e può ometterne qualcuno.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            positions = try c.decodeIfPresent([String: Pos].self, forKey: .positions) ?? [:]
            watched = try c.decodeIfPresent(Set<String>.self, forKey: .watched) ?? []
            lastEpisode = try c.decodeIfPresent([String: Last].self, forKey: .lastEpisode) ?? [:]
            myList = try c.decodeIfPresent([String: Double].self, forKey: .myList) ?? [:]
        }
    }

    private var f = File()
    private let url: URL
    /// Ogni modifica, nel formato delle operazioni di /api/ops: col server di casa partono verso il server.
    var onChange: (([String: Any]) -> Void)?

    private static var nowMs: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    init(url: URL) {
        self.url = url
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) { f = file }
    }

    func save() { try? JSONEncoder().encode(f).write(to: url, options: .atomic) }

    /// Tutto il contenuto come dizionario JSON (per /api/import-native).
    func toJson() -> [String: Any] {
        guard let data = try? JSONEncoder().encode(f), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return o
    }

    /// Sostituisce tutto con lo stato del server di casa.
    func replace(with o: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: o), let file = try? JSONDecoder().decode(File.self, from: data) else { return }
        f = file
        save()
    }

    /// Da dove riprendere in secondi (0 = dall'inizio). Non riprende i primi 30 s né gli ultimi 90 s.
    func resume(_ key: String) -> Double {
        guard let e = f.positions[key] else { return 0 }
        return e.p > 30_000 && (e.d <= 0 || e.d - e.p > 90_000) ? e.p / 1000 : 0
    }

    func progress(_ key: String) -> Double {
        if f.watched.contains(key) { return 1 }
        guard let e = f.positions[key], e.d > 0 else { return 0 }
        return min(0.99, max(0, e.p / e.d))
    }

    func isWatched(_ key: String) -> Bool { f.watched.contains(key) }
    func updatedAt(_ key: String) -> Double { f.positions[key]?.u ?? 0 }

    /// Aggiorna la posizione (in secondi). Restituisce true se il contenuto risulta finito.
    @discardableResult
    func update(_ key: String, position: Double, duration: Double) -> Bool {
        let p = (position * 1000).rounded(), d = (duration * 1000).rounded()
        guard d > 0, p > 0 else { return false }
        if p >= d * 0.95 || d - p < 90_000 { markWatched(key); return true }
        guard p >= 30_000 else { return false }
        f.positions[key] = Pos(p: p, d: d, u: Self.nowMs)
        f.watched.remove(key)
        onChange?(["op": "position", "key": key, "p": Int(p), "d": Int(d)])
        return false
    }

    func markWatched(_ key: String) {
        f.positions[key] = nil
        f.watched.insert(key)
        onChange?(["op": "watched", "key": key])
    }

    func forget(_ key: String) {
        f.positions[key] = nil
        onChange?(["op": "forgetPosition", "key": key])
    }

    func setLastEpisode(series: Int, episode: String) {
        f.lastEpisode[String(series)] = Last(id: episode, u: Self.nowMs)
        onChange?(["op": "lastEpisode", "seriesId": series, "id": episode])
    }
    func lastEpisode(_ series: Int) -> (id: String, at: Double)? {
        f.lastEpisode[String(series)].map { ($0.id, $0.u) }
    }
    func forgetSeries(_ series: Int) {
        f.lastEpisode[String(series)] = nil
        onChange?(["op": "forgetSeries", "seriesId": series])
    }

    func inMyList(_ key: String) -> Bool { f.myList[key] != nil }
    /// Le chiavi della "Mia lista", dall'ultima aggiunta.
    func myList() -> [String] { f.myList.sorted { $0.value > $1.value }.map(\.key) }
    func setMyList(_ key: String, _ on: Bool) {
        guard (f.myList[key] != nil) != on else { return }
        f.myList[key] = on ? Self.nowMs : nil
        onChange?(["op": "myList", "key": key, "on": on])
    }
}
