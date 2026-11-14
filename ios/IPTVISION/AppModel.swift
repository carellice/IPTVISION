import Foundation
import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case live, movies, series, search, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .live: "TV in diretta"
        case .movies: "Film"
        case .series: "Serie TV"
        case .search: "Cerca"
        case .settings: "Impostazioni"
        }
    }
    var icon: String {
        switch self {
        case .live: "tv"
        case .movies: "film"
        case .series: "square.stack"
        case .search: "magnifyingglass"
        case .settings: "gearshape"
        }
    }
}

enum ListSort: String, CaseIterable, Identifiable {
    case `default`, number, nameAsc, nameDesc, year, rating, recent
    var id: String { rawValue }
    var label: String {
        switch self {
        case .default: "Ordine del provider"
        case .number: "Numero"
        case .nameAsc: "Nome A-Z"
        case .nameDesc: "Nome Z-A"
        case .year: "Anno"
        case .rating: "Voto"
        case .recent: "Aggiunti di recente"
        }
    }
    static func options(_ s: AppSection) -> [ListSort] {
        switch s {
        case .live: [.default, .number, .nameAsc, .nameDesc]
        case .movies: [.default, .recent, .nameAsc, .nameDesc, .year, .rating]
        default: [.default, .nameAsc, .nameDesc, .year, .rating]
        }
    }
}

let allId = "__all", favoritesId = "__fav", continueId = "__continue", myListId = "__mylist"

struct Library<T> {
    let categories: [Category]
    let items: [T]
    let byCategory: [String: [T]]
}

enum Playing: Equatable {
    case live(Channel, playlist: [Channel])
    case film(Movie)
    case episode(Series, Episode, episodes: [Episode])

    var key: String? {
        switch self {
        case .live: nil
        case .film(let m): m.key
        case .episode(_, let e, _): e.key
        }
    }
    var title: String {
        switch self {
        case .live(let c, _): c.name
        case .film(let m): m.name
        case .episode(let s, let e, _): "\(s.name) · \(e.label) \(e.displayTitle)"
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var account: Account? = AppSettings.account
    @Published var loginBusy = false
    @Published var loginError: String?
    @Published var error: String?

    @Published var live: Library<Channel>?
    @Published var movies: Library<Movie>?
    @Published var series: Library<Series>?
    @Published var liveLoading = false
    @Published var moviesLoading = false
    @Published var seriesLoading = false

    @Published var favorites = AppSettings.favorites
    @Published var lists = AppSettings.lists
    @Published var hideAdult = AppSettings.hideAdult {
        didSet {
            guard hideAdult != oldValue else { return }
            AppSettings.hideAdult = hideAdult
            queueServerOp(["op": "hideAdult", "on": hideAdult], now: true)
            reloadFromCache()
        }
    }
    @Published var outputFormat = AppSettings.outputFormat { didSet { AppSettings.outputFormat = outputFormat } }
    @Published var sorts: [AppSection: ListSort] = Dictionary(uniqueKeysWithValues: [AppSection.live, .movies, .series].map { ($0, AppSettings.sort($0)) })
    /// Cambia quando cambiano posizioni o "La mia lista": le viste che ne dipendono si ridisegnano.
    @Published var positionsVersion = 0

    @Published var playing: Playing?
    @Published var epg: [Int: [Programme]] = [:]

    // Server di casa
    @Published var homeServer = AppSettings.homeServer
    @Published var serverLists: [SavedList] = []
    @Published var serverBusy = false
    @Published var serverError: String?
    @Published var serverSyncedAt: Date?
    /// Come esce su Internet il server: per esempio "VPN attiva · Svizzera · 185.1.2.3".
    @Published var serverNetwork: String?
    private var pendingOps: [[String: Any]] = []
    /// Il player registra qui come salvare il punto raggiunto, così la sincronizzazione lo include.
    var savePlayingPosition: (() -> Void)?

    /// Le liste mostrate nelle impostazioni: col server di casa sono quelle del server.
    var shownLists: [SavedList] { homeServer == nil ? lists : serverLists }

    let positions: PositionStore
    private let cacheDir: URL

    var client: XtreamClient? { account.map { XtreamClient(account: $0) } }

    init() {
        let docs = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        positions = PositionStore(url: docs.appendingPathComponent("positions.json"))
        cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        positions.onChange = { [weak self] op in self?.queueServerOp(op) }
        if account != nil { Task { await loadLive(refresh: false) } }
        Task { [weak self] in
            // Server di casa: ogni 30 secondi le modifiche fatte qui partono e quelle degli altri dispositivi arrivano.
            while !Task.isCancelled {
                guard let self else { return }
                if self.homeServer != nil { await self.syncServer() }
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }

    // MARK: - Account

    func login(serverInput: String, user: String, pass: String, alias: String) async {
        let parsed = XtreamClient.parseServerInput(serverInput)
        let username = user.trimmingCharacters(in: .whitespaces).isEmpty ? (parsed.user ?? "") : user.trimmingCharacters(in: .whitespaces)
        let password = pass.isEmpty ? (parsed.pass ?? "") : pass
        guard !parsed.server.isEmpty, !username.isEmpty else { loginError = "Inserisci server e nome utente."; return }
        let acc = Account(server: parsed.server, username: username, password: password)
        let name = alias.trimmingCharacters(in: .whitespaces)
        loginBusy = true
        loginError = nil
        defer { loginBusy = false }
        do {
            if let home = homeServer, let token = account?.password {
                // Col server di casa la lista nuova va sul server, che la usa per tutti i dispositivi.
                try await ServerApi.sendXtream(home, token: token, account: acc, alias: name)
                reloadFromServer(nil)
                return
            }
            let info = try await XtreamClient(account: acc).authenticate()
            var l = lists.filter { !$0.isSame(acc) }
            l.append(SavedList(alias: name.isEmpty ? (URL(string: acc.server)?.host ?? acc.server) : name,
                               server: acc.server, username: acc.username, password: acc.password, expiresAt: info.expiresAt))
            lists = l
            AppSettings.lists = l
            use(acc)
        } catch {
            loginError = error.localizedDescription
        }
    }

    func use(_ l: SavedList) {
        if let home = homeServer, let token = account?.password, let index = l.index {
            Task {
                do { reloadFromServer(try await ServerApi.useList(home, token: token, index: index)) }
                catch { serverError = error.localizedDescription }
            }
            return
        }
        use(Account(server: l.server, username: l.username, password: l.password))
    }

    private func use(_ acc: Account) {
        playing = nil
        account = acc
        AppSettings.account = acc
        live = nil; movies = nil; series = nil; epg = [:]
        Task { await loadLive(refresh: false) }
    }

    func removeList(_ l: SavedList) {
        if let home = homeServer, let token = account?.password, let index = l.index {
            // Senza lista in uso il server non avrebbe niente da mostrare a nessun dispositivo.
            if l.active == true { serverError = "Prima passa a un'altra lista."; return }
            Task {
                do { try await ServerApi.removeList(home, token: token, index: index) } catch { serverError = error.localizedDescription }
                await loadServerLists()
            }
            return
        }
        lists.removeAll { $0.id == l.id }
        AppSettings.lists = lists
    }

    func logout() {
        if let home = homeServer, let token = account?.password {
            Task { await ServerApi.logout(home, token: token) }
            forgetServer()
        }
        playing = nil
        account = nil
        AppSettings.account = nil
        live = nil; movies = nil; series = nil
    }

    // MARK: - Server di casa

    /// Collega il server di casa: accede (o crea l'account), porta sul server l'account IPTV di questo
    /// dispositivo se lì manca, unisce preferiti e posizioni di qui a quelli del server, poi usa il server
    /// come server Xtream. Se qualcosa va storto l'app resta com'era. Restituisce true se è collegato.
    func connectServer(address: String, user: String, pass: String, register: Bool, invite: String) async -> Bool {
        let url = ServerApi.normalizeUrl(address)
        let user = user.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, !user.isEmpty, !pass.isEmpty else {
            serverError = "Inserisci indirizzo del server, nome utente e password."
            return false
        }
        serverBusy = true
        serverError = nil
        defer { serverBusy = false }
        var token: String?
        do {
            let login = try await ServerApi.login(url, username: user, password: pass, register: register, invite: invite)
            token = login.token
            let own = homeServer == nil ? account : nil
            if !login.hasXtream {
                guard let own else {
                    throw ServerError(message: "Questo account non ha ancora un account IPTV: aggiungilo da IPTVISION nel browser, poi riprova.")
                }
                try await ServerApi.sendXtream(url, token: login.token, account: own)
            }
            var mine = positions.toJson()
            mine["favorites"] = Array(favorites)
            // Le liste salvate qui si aggiungono a quelle del server.
            if own != nil {
                mine["lists"] = lists.map { l -> [String: Any] in
                    ["alias": l.alias, "server": l.server, "username": l.username, "password": l.password,
                     "expiresAt": l.expiresAt.map { $0 as Any } ?? NSNull()]
                }
            }
            let state = try await ServerApi.importNative(url, token: login.token, data: mine)
            if let old = homeServer, let oldToken = account?.password {
                await ServerApi.logout(old, token: oldToken)
            } else {
                AppSettings.ownAccount = account
            }
            pendingOps.removeAll()
            homeServer = url
            AppSettings.homeServer = url
            AppSettings.homeRevision = nil
            applyServerState(state)
            use(Account(server: url, username: login.username, password: login.token))
            clearListCache()
            await loadServerLists()
            await loadServerNetwork()
            return true
        } catch {
            if let token, account?.password != token { await ServerApi.logout(url, token: token) }
            serverError = error.localizedDescription
            return false
        }
    }

    /// Torna a usare l'account IPTV di prima direttamente dal provider. Preferiti e posizioni restano quelli di adesso.
    func disconnectServer() {
        guard let home = homeServer, let token = account?.password else { return }
        Task { await ServerApi.logout(home, token: token) }
        let own = AppSettings.ownAccount
        forgetServer()
        if let own { use(own) } else { logout() }
    }

    private func forgetServer() {
        pendingOps.removeAll()
        homeServer = nil
        AppSettings.homeServer = nil
        AppSettings.homeRevision = nil
        AppSettings.ownAccount = nil
        serverLists = []
        serverSyncedAt = nil
        serverNetwork = nil
    }

    func loadServerLists() async {
        guard let home = homeServer, let token = account?.password else { return }
        do { serverLists = try await ServerApi.lists(home, token: token) } catch { serverError = error.localizedDescription }
    }

    func loadServerNetwork() async {
        guard let home = homeServer, let token = account?.password else { serverNetwork = nil; return }
        serverNetwork = (try? await ServerApi.network(home, token: token))?["label"] as? String
    }

    /// Col server di casa la lista in uso è cambiata: liste e guida ripartono da zero, il gettone resta.
    private func reloadFromServer(_ state: [String: Any]?) {
        if let state { applyServerState(state) }
        clearListCache()
        serverLists = []
        if let acc = account { use(acc) }
        Task { await loadServerLists() }
    }

    func queueServerOp(_ op: [String: Any], now: Bool = false) {
        guard homeServer != nil else { return }
        pendingOps.append(op)
        if now { Task { await flushServerOps() } }
    }

    /// Manda al server le modifiche fatte qui; se non risponde restano in coda e ripartono dopo.
    private func flushServerOps() async {
        guard let home = homeServer, let token = account?.password, !pendingOps.isEmpty else { return }
        let ops = pendingOps
        pendingOps.removeAll()
        do {
            let state = try await ServerApi.ops(home, token: token, ops: ops)
            applyServerState(state)
        } catch {
            pendingOps.insert(contentsOf: ops, at: 0)
        }
    }

    /// Le modifiche fatte qui partono, quelle degli altri dispositivi dello stesso account arrivano.
    func syncServer(force: Bool = false) async {
        guard let home = homeServer, let token = account?.password else { return }
        savePlayingPosition?()
        await flushServerOps()
        do {
            if let state = try await ServerApi.state(home, token: token, since: force ? nil : AppSettings.homeRevision) {
                applyServerState(state)
            }
            serverSyncedAt = Date()
            serverError = nil
        } catch {
            serverError = error.localizedDescription
        }
        await loadServerNetwork()
    }

    private func applyServerState(_ o: [String: Any]) {
        serverSyncedAt = Date()
        guard pendingOps.isEmpty else { return } // prima partono le nostre
        AppSettings.homeRevision = XtreamClient.int(o["revision"])
        favorites = Set((o["favorites"] as? [Any] ?? []).compactMap { XtreamClient.int($0) })
        AppSettings.favorites = favorites
        positions.replace(with: o)
        positionsVersion += 1
        if let h = o["hideAdult"] as? Bool, h != hideAdult { hideAdult = h }
    }

    // MARK: - Liste

    private func file(_ kind: String) -> URL { cacheDir.appendingPathComponent("\(kind)_\(account?.key ?? "none").json") }

    /// Scarica [kinds] se il file manca, è vecchio di oltre 12 ore o [refresh] è true.
    private func fetch(_ kinds: [(action: String, kind: String)], refresh: Bool) async throws {
        guard let c = client else { return }
        for k in kinds {
            let f = file(k.kind)
            let date = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            let fresh = date.map { Date().timeIntervalSince($0) < 12 * 3600 } ?? false
            if refresh || !fresh {
                do { try await c.download(k.action, to: f) }
                catch { if !FileManager.default.fileExists(atPath: f.path) { throw error } } // la copia vecchia va bene lo stesso
            }
        }
    }

    private func library<T>(_ cats: [Category], _ items: [T], cat: (T) -> String?) -> Library<T> {
        let hidden = hideAdult ? Set(cats.filter { $0.name.lowercased().contains("xxx") }.map(\.id)) : []
        let visible = hidden.isEmpty ? items : items.filter { !hidden.contains(cat($0) ?? "") }
        return Library(categories: cats.filter { !hidden.contains($0.id) }, items: visible,
                       byCategory: Dictionary(grouping: visible) { cat($0) ?? "" })
    }

    func loadLive(refresh: Bool) async {
        liveLoading = true
        defer { liveLoading = false }
        do {
            try await fetch([("get_live_categories", "live_cats"), ("get_live_streams", "live")], refresh: refresh)
            let (cf, sf) = (file("live_cats"), file("live"))
            let (cats, items) = try await Task.detached { (try XtreamClient.parseCategories(cf), try XtreamClient.parseChannels(sf)) }.value
            live = library(cats, items) { $0.categoryId }
        } catch is CancellationError {
        } catch {
            if let e = error as? XtreamError, e.isAuthError { self.error = e.message } else { self.error = error.localizedDescription }
        }
    }

    func ensureMovies(refresh: Bool = false) async {
        guard (movies == nil || refresh), !moviesLoading else { return }
        moviesLoading = true
        defer { moviesLoading = false }
        do {
            try await fetch([("get_vod_categories", "vod_cats"), ("get_vod_streams", "vod")], refresh: refresh)
            let (cf, sf) = (file("vod_cats"), file("vod"))
            let (cats, items) = try await Task.detached { (try XtreamClient.parseCategories(cf), try XtreamClient.parseMovies(sf)) }.value
            movies = library(cats, items) { $0.categoryId }
        } catch { self.error = error.localizedDescription }
    }

    func ensureSeries(refresh: Bool = false) async {
        guard (series == nil || refresh), !seriesLoading else { return }
        seriesLoading = true
        defer { seriesLoading = false }
        do {
            try await fetch([("get_series_categories", "series_cats"), ("get_series", "series")], refresh: refresh)
            let (cf, sf) = (file("series_cats"), file("series"))
            let (cats, items) = try await Task.detached { (try XtreamClient.parseCategories(cf), try XtreamClient.parseSeries(sf)) }.value
            series = library(cats, items) { $0.categoryId }
        } catch { self.error = error.localizedDescription }
    }

    func refreshAll() async {
        let hadMovies = movies != nil, hadSeries = series != nil
        await loadLive(refresh: true)
        if hadMovies { await ensureMovies(refresh: true) }
        if hadSeries { await ensureSeries(refresh: true) }
    }

    /// Dopo "Nascondi XXX": rilegge le liste già scaricate.
    private func reloadFromCache() {
        let hadMovies = movies != nil, hadSeries = series != nil
        movies = nil; series = nil
        Task {
            await loadLive(refresh: false)
            if hadMovies { await ensureMovies() }
            if hadSeries { await ensureSeries() }
        }
    }

    func clearCache() {
        clearListCache()
        Task { await refreshAll() }
    }

    private func clearListCache() {
        for k in ["live", "live_cats", "vod", "vod_cats", "series", "series_cats"] { try? FileManager.default.removeItem(at: file(k)) }
    }

    // MARK: - Ordinamento e filtri

    func sort(_ s: AppSection) -> ListSort { sorts[s] ?? .default }
    func setSort(_ s: AppSection, _ v: ListSort) { sorts[s] = v; AppSettings.setSort(s, v) }

    func channels(_ categoryId: String) -> [Channel] {
        guard let l = live else { return [] }
        let list: [Channel] = switch categoryId {
        case allId: l.items
        case favoritesId: l.items.filter { favorites.contains($0.streamId) }
        default: l.byCategory[categoryId] ?? []
        }
        switch sort(.live) {
        case .number: return list.sorted { ($0.num <= 0 ? Int.max : $0.num) < ($1.num <= 0 ? Int.max : $1.num) }
        case .nameAsc: return list.sorted { $0.searchKey < $1.searchKey }
        case .nameDesc: return list.sorted { $0.searchKey > $1.searchKey }
        default: return list
        }
    }

    func movieEntries(_ categoryId: String) -> [TitleEntry<Movie>] {
        guard let l = movies else { return [] }
        let list: [Movie] = switch categoryId {
        case allId: l.items
        case continueId: l.items.filter { positions.resume($0.key) > 0 }.sorted { positions.updatedAt($0.key) > positions.updatedAt($1.key) }
        case myListId: inListOrder(l.items, key: \.key)
        default: l.byCategory[categoryId] ?? []
        }
        let sorted: [Movie] = switch sort(.movies) {
        case .recent: list.sorted { $0.added > $1.added }
        case .nameAsc: list.sorted { $0.searchKey < $1.searchKey }
        case .nameDesc: list.sorted { $0.searchKey > $1.searchKey }
        case .year: list.sorted { (Int($0.year ?? "") ?? 0, $1.searchKey) > (Int($1.year ?? "") ?? 0, $0.searchKey) }
        case .rating: list.sorted { ($0.rating, $1.searchKey) > ($1.rating, $0.searchKey) }
        default: list
        }
        return groupVariants(sorted) { $0.variantKey }
    }

    func seriesEntries(_ categoryId: String) -> [TitleEntry<Series>] {
        guard let l = series else { return [] }
        let list: [Series] = switch categoryId {
        case allId: l.items
        case continueId: l.items.compactMap { s in positions.lastEpisode(s.seriesId).map { (s, $0.at) } }.sorted { $0.1 > $1.1 }.map(\.0)
        case myListId: inListOrder(l.items, key: \.key)
        default: l.byCategory[categoryId] ?? []
        }
        let sorted: [Series] = switch sort(.series) {
        case .nameAsc: list.sorted { $0.searchKey < $1.searchKey }
        case .nameDesc: list.sorted { $0.searchKey > $1.searchKey }
        case .year: list.sorted { (Int($0.year ?? "") ?? 0, $1.searchKey) > (Int($1.year ?? "") ?? 0, $0.searchKey) }
        case .rating: list.sorted { ($0.rating, $1.searchKey) > ($1.rating, $0.searchKey) }
        default: list
        }
        return groupVariants(sorted) { $0.variantKey }
    }

    private func inListOrder<T>(_ items: [T], key: (T) -> String) -> [T] {
        let order = Dictionary(uniqueKeysWithValues: positions.myList().enumerated().map { ($1, $0) })
        return items.filter { order[key($0)] != nil }.sorted { order[key($0)]! < order[key($1)]! }
    }

    // MARK: - Preferiti e "La mia lista"

    func toggleFavorite(_ c: Channel) {
        let on = !favorites.contains(c.streamId)
        if on { favorites.insert(c.streamId) } else { favorites.remove(c.streamId) }
        AppSettings.favorites = favorites
        queueServerOp(["op": "favorite", "streamId": c.streamId, "on": on], now: true)
    }

    /// In lista basta una delle versioni dello stesso titolo.
    private func movieKeys(_ m: Movie) -> [String] { ((movies?.items.filter { $0.variantKey == m.variantKey } ?? []).map(\.key) + [m.key]) }
    private func seriesKeys(_ s: Series) -> [String] { ((series?.items.filter { $0.variantKey == s.variantKey } ?? []).map(\.key) + [s.key]) }

    func inMyList(_ m: Movie) -> Bool { movieKeys(m).contains(where: positions.inMyList) }
    func inMyList(_ s: Series) -> Bool { seriesKeys(s).contains(where: positions.inMyList) }

    func toggleMyList(_ m: Movie) { setMyList(movieKeys(m), m.key, !inMyList(m)) }
    func toggleMyList(_ s: Series) { setMyList(seriesKeys(s), s.key, !inMyList(s)) }

    private func setMyList(_ keys: [String], _ key: String, _ on: Bool) {
        if on { positions.setMyList(key, true) } else { keys.forEach { positions.setMyList($0, false) } }
        positions.save()
        positionsVersion += 1
    }

    func removeFromContinue(_ m: Movie) { movieKeys(m).forEach(positions.forget); positions.save(); positionsVersion += 1 }
    func removeFromContinue(_ s: Series) { positions.forgetSeries(s.seriesId); positions.save(); positionsVersion += 1 }

    // MARK: - Ricerca

    func search(_ query: String) -> (channels: [Channel], movies: [TitleEntry<Movie>], series: [TitleEntry<Series>]) {
        let q = TextHelpers.normalize(query)
        guard q.count >= 2 else { return ([], [], []) }
        let ch = Array((live?.items ?? []).filter { $0.searchKey.contains(q) }.prefix(100))
        let mv = Array(groupVariants((movies?.items ?? []).filter { $0.searchKey.contains(q) }) { $0.variantKey }.prefix(100))
        let se = Array(groupVariants((series?.items ?? []).filter { $0.searchKey.contains(q) }) { $0.variantKey }.prefix(100))
        return (ch, mv, se)
    }

    // MARK: - Guida TV

    func loadEpg(_ c: Channel) async {
        guard epg[c.streamId] == nil, let client else { return }
        epg[c.streamId] = []
        epg[c.streamId] = (try? await client.shortEpg(c.streamId)) ?? []
    }

    func nowNext(_ c: Channel) -> (now: Programme?, next: Programme?) {
        let now = Int(Date().timeIntervalSince1970)
        let list = epg[c.streamId] ?? []
        let i = list.firstIndex { $0.start <= now && now < $0.stop }
        return (i.map { list[$0] }, i.flatMap { $0 + 1 < list.count ? list[$0 + 1] : nil })
    }

    // MARK: - Riproduzione

    func play(_ p: Playing) { playing = p }

    func url(for p: Playing) -> URL? {
        guard let c = client else { return nil }
        switch p {
        case .live(let ch, _): return c.liveUrl(ch.streamId, ext: outputFormat)
        case .film(let m): return c.movieUrl(m)
        case .episode(_, let e, _): return c.episodeUrl(e)
        }
    }

    func resumePoint(for p: Playing, fromStart: Bool) -> Double {
        guard !fromStart, let k = p.key else { return 0 }
        return positions.resume(k)
    }

    /// Canale successivo (+1) o precedente (-1) nella lista da cui è stato aperto.
    func zap(_ delta: Int) {
        guard case .live(let ch, let list)? = playing, !list.isEmpty else { return }
        let i = list.firstIndex { $0.streamId == ch.streamId } ?? 0
        let n = ((i + delta) % list.count + list.count) % list.count
        playing = .live(list[n], playlist: list)
    }

    /// L'episodio da cui riprendere: l'ultimo aperto se non finito, altrimenti il successivo.
    func resumeEpisode(_ eps: [Episode], series: Int) -> Episode? {
        guard let first = eps.first else { return nil }
        guard let last = positions.lastEpisode(series)?.id, let i = eps.firstIndex(where: { $0.id == last }) else { return first }
        return positions.isWatched(eps[i].key) && i + 1 < eps.count ? eps[i + 1] : eps[i]
    }

    func playEpisode(_ s: Series, _ e: Episode, _ eps: [Episode]) {
        positions.setLastEpisode(series: s.seriesId, episode: e.id)
        positions.save()
        playing = .episode(s, e, episodes: eps)
    }

    func nextEpisode() -> Episode? {
        guard case .episode(_, let e, let eps)? = playing, let i = eps.firstIndex(where: { $0.id == e.id }), i + 1 < eps.count else { return nil }
        return eps[i + 1]
    }

    func playNextEpisode() {
        guard case .episode(let s, _, let eps)? = playing, let n = nextEpisode() else { return }
        playEpisode(s, n, eps)
    }

    /// Salva il punto raggiunto; true se il contenuto è finito.
    @discardableResult
    func savePosition(_ p: Playing, position: Double, duration: Double) -> Bool {
        guard let k = p.key else { return false }
        let done = positions.update(k, position: position, duration: duration)
        if done, case .film(let m) = p { movieKeys(m).forEach { positions.setMyList($0, false) } }
        positions.save()
        positionsVersion += 1
        return done
    }

    func markWatched(_ p: Playing) {
        guard let k = p.key else { return }
        positions.markWatched(k)
        if case .film(let m) = p { movieKeys(m).forEach { positions.setMyList($0, false) } }
        positions.save()
        positionsVersion += 1
    }
}
