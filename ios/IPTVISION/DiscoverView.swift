import SwiftUI

// "Film e serie" con la chiave TMDB: film e serie in una sola schermata, come le app di streaming.
// In alto un titolo di tendenza che cambia da solo, poi le righe: continua a guardare, la mia lista,
// tendenze, generi e in fondo le categorie della lista. Come PWA/web/src/screens/Discover.tsx.

/// Un titolo del catalogo con la sua scheda TMDB, se trovata.
struct DiscoverTitle: Identifiable, Hashable {
    var movie: TitleEntry<Movie>?
    var show: TitleEntry<Series>?
    var card: Tmdb.Card?

    var id: String { movie?.item.key ?? show?.item.key ?? "" }
    var isMovie: Bool { movie != nil }
    var name: String { movie?.item.name ?? show?.item.name ?? "" }
    var year: String? { movie?.item.year ?? show?.item.year }
    var poster: String? { movie?.item.poster ?? show?.item.cover }
    var kind: Tmdb.Kind { isMovie ? .movie : .tv }
}

/// "Vedi tutto" di una categoria: film o serie.
struct DiscoverCategory: Hashable {
    let movies: Bool
    let id: String
}

private enum Filter { case all, movies, series }

struct DiscoverView: View {
    @EnvironmentObject var model: AppModel
    @State private var filter = Filter.all
    /// Con "Tutto": le categorie della lista mostrate in fondo, dei film o delle serie (mai insieme).
    @State private var catSeries = false
    @State private var matched: [(row: Tmdb.Row, titles: [DiscoverTitle])]?

    var body: some View {
        Group {
            // Si mostra appena c'è uno dei due cataloghi: l'altro (e TMDB) arriva dopo, senza bloccare la pagina.
            if model.movies != nil || model.series != nil {
                content(model.movies ?? Library(categories: [], items: [], byCategory: [:]),
                        model.series ?? Library(categories: [], items: [], byCategory: [:]))
            } else {
                ScrollView { VStack(alignment: .leading, spacing: 22) { ForEach(0..<3, id: \.self) { _ in SkeletonRow() } }.padding(.vertical) }
            }
        }
        .navigationTitle("Film e serie")
        .overlay(alignment: .topTrailing) { LoadingBadge(extra: matched == nil && model.tmdbError == nil ? "Preparo le tendenze…" : nil) }
        .navigationDestination(for: TitleEntry<Movie>.self) { MovieDetail(entry: $0) }
        .navigationDestination(for: TitleEntry<Series>.self) { SeriesDetail(entry: $0) }
        .navigationDestination(for: DiscoverCategory.self) { c in
            if c.movies { MovieGrid(categoryId: c.id) } else { SeriesGrid(categoryId: c.id) }
        }
        .task {
            await model.ensureMovies()
            await model.ensureSeries()
            await model.loadTmdb()
        }
        .task(id: "\(model.movies?.items.count ?? -1)|\(model.series?.items.count ?? -1)|\(model.tmdbRows?.count ?? -1)") { await match() }
    }

    /// Le liste di TMDB diventano titoli del catalogo, ognuno una volta per riga (fuori dal thread principale).
    private func match() async {
        guard let rows = model.tmdbRows, model.movies != nil || model.series != nil else { matched = nil; return }
        let movies = model.movies?.items ?? [], series = model.series?.items ?? []
        matched = await Task.detached(priority: .userInitiated) { () -> [(row: Tmdb.Row, titles: [DiscoverTitle])] in
            func byKey<T>(_ entries: [TitleEntry<T>], _ name: (T) -> String) -> [String: TitleEntry<T>] {
                var m: [String: TitleEntry<T>] = [:]
                for e in entries { let k = Tmdb.matchKey(name(e.item)); if !k.isEmpty && m[k] == nil { m[k] = e } }
                return m
            }
            let ms = byKey(groupVariants(movies) { $0.variantKey }) { $0.name }
            let ss = byKey(groupVariants(series) { $0.variantKey }) { $0.name }
            return rows.map { r in
                var seen = Set<String>()
                var out: [DiscoverTitle] = []
                for c in r.items {
                    var hit: DiscoverTitle?
                    for k in c.keys where hit == nil {
                        if c.kind == .movie, let e = ms[k], Tmdb.yearsClose(e.item.year, c.year) { hit = DiscoverTitle(movie: e, card: c) }
                        if c.kind == .tv, let e = ss[k], Tmdb.yearsClose(e.item.year, c.year) { hit = DiscoverTitle(show: e, card: c) }
                    }
                    if let h = hit, seen.insert(h.id).inserted { out.append(h) }
                }
                return (row: r, titles: out)
            }
        }.value
    }

    private func pass(_ t: DiscoverTitle) -> Bool { filter == .all || (filter == .movies) == t.isMovie }

    private struct Rows {
        var cont: [DiscoverTitle] = []
        var mine: [DiscoverTitle] = []
        var rows: [(row: Tmdb.Row, titles: [DiscoverTitle])] = []
        var recent: [DiscoverTitle] = []
    }

    private func buildRows(_ movies: Library<Movie>) -> Rows {
        var r = Rows()
        var known: [String: Tmdb.Card] = [:]
        for t in (matched ?? []).flatMap({ $0.titles }) where known[t.id] == nil { known[t.id] = t.card }
        let cm: [DiscoverTitle] = model.movieEntries(continueId).map { DiscoverTitle(movie: $0, card: known[$0.item.key]) }
        let cs: [DiscoverTitle] = model.seriesEntries(continueId).map { DiscoverTitle(show: $0, card: known[$0.item.key]) }
        r.cont = (cm + cs).sorted { recency($0) > recency($1) }.filter(pass)
        let mm: [DiscoverTitle] = model.movieEntries(myListId).map { DiscoverTitle(movie: $0, card: known[$0.item.key]) }
        let ms: [DiscoverTitle] = model.seriesEntries(myListId).map { DiscoverTitle(show: $0, card: known[$0.item.key]) }
        r.mine = (mm + ms).filter(pass)
        r.rows = (matched ?? []).map { (row: $0.row, titles: $0.titles.filter(pass)) }.filter { $0.titles.count >= ($0.row.top ? 5 : 4) }
        let newest = Array(movies.items.sorted { $0.added > $1.added }.prefix(80))
        r.recent = groupVariants(newest) { $0.variantKey }.prefix(30).map { DiscoverTitle(movie: $0, card: known[$0.item.key]) }
        return r
    }

    @ViewBuilder
    private func content(_ movies: Library<Movie>, _ series: Library<Series>) -> some View {
        let _ = model.positionsVersion
        let d = buildRows(movies)
        let cont = d.cont, mine = d.mine, rows = d.rows, recent = d.recent

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(text: "Tutto", selected: filter == .all) { filter = .all }
                        Chip(text: "Film", selected: filter == .movies) { filter = .movies }
                        Chip(text: "Serie TV", selected: filter == .series) { filter = .series }
                        NavigationLink {
                            CategoriesPage(movies: filter != .series ? movies.categories : [], series: filter != .movies ? series.categories : [])
                        } label: {
                            HStack(spacing: 4) { Text("Categorie"); Image(systemName: "chevron.down").font(.caption) }
                                .font(.subheadline.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Theme.card, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal)
                }
                if let e = model.tmdbError {
                    Text("\(e) Controlla la chiave in Impostazioni → TMDB.").font(.subheadline).foregroundStyle(.red).padding(.horizontal)
                }
                if matched == nil && model.tmdbError == nil { ForEach(0..<2, id: \.self) { _ in SkeletonRow() } }
                if !cont.isEmpty {
                    TitleRow(title: "Continua a guardare") { ForEach(cont) { WideTile(title: $0) } }
                }
                if !mine.isEmpty {
                    TitleRow(title: "La mia lista") { ForEach(mine) { PosterTile(title: $0, lookup: true) } }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    TitleRow(title: r.row.top ? "\(r.row.title) in Italia" : r.row.title) {
                        if r.row.top {
                            ForEach(Array(r.titles.prefix(10).enumerated()), id: \.offset) { n, t in TopTile(title: t, rank: n + 1) }
                        } else {
                            ForEach(r.titles.prefix(40)) { PosterTile(title: $0) }
                        }
                    }
                    if i == 1 && filter != .series && !recent.isEmpty {
                        TitleRow(title: "Aggiunti di recente", all: DiscoverCategory(movies: true, id: allId)) {
                            ForEach(recent) { PosterTile(title: $0, lookup: true) }
                        }
                    }
                }
                if matched != nil && rows.isEmpty && model.tmdbError == nil {
                    Text("Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista.")
                        .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal)
                }
                Text("Le categorie della lista").font(.title2.weight(.heavy)).padding(.horizontal).padding(.top, 18)
                // Con "Tutto" un selettore Film / Serie TV: le categorie di un tipo alla volta.
                let catSwitch = filter == .all && !movies.categories.isEmpty && !series.categories.isEmpty
                if catSwitch {
                    Picker("Categorie della lista", selection: $catSeries) {
                        Text("Film").tag(false)
                        Text("Serie TV").tag(true)
                    }
                    .pickerStyle(.segmented).frame(maxWidth: 260).padding(.horizontal)
                }
                // Le categorie della lista a griglia (nome e quanti titoli): toccandone una si aprono tutti i suoi titoli.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    if catSwitch ? !catSeries : filter != .series {
                        ForEach(movies.categories) { c in
                            CategoryTile(category: DiscoverCategory(movies: true, id: c.id), name: c.name, count: movies.byCategory[c.id]?.count ?? 0)
                        }
                    }
                    if catSwitch ? catSeries : filter != .movies {
                        ForEach(series.categories) { c in
                            CategoryTile(category: DiscoverCategory(movies: false, id: c.id), name: c.name, count: series.byCategory[c.id]?.count ?? 0)
                        }
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .refreshable { await model.refreshAll() }
    }

    private func recency(_ t: DiscoverTitle) -> Double {
        if let m = t.movie { return m.variants.map { model.positions.updatedAt($0.key) }.max() ?? 0 }
        return t.show.flatMap { model.positions.lastEpisode($0.item.seriesId)?.at } ?? 0
    }
}

private struct Chip: View {
    let text: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text).font(.subheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 8)
                .foregroundStyle(selected ? Color.black : Color.primary)
                .background(selected ? Color.white : Theme.card, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Il link che apre il titolo: la scheda del film o gli episodi della serie.
private struct TitleLink<Label: View>: View {
    let title: DiscoverTitle
    @ViewBuilder let label: () -> Label

    var body: some View {
        if let m = title.movie { NavigationLink(value: m, label: label).buttonStyle(.plain) }
        else if let s = title.show { NavigationLink(value: s, label: label).buttonStyle(.plain) }
    }
}

// MARK: - Le righe

private struct TitleRow<Content: View>: View {
    let title: String
    var all: DiscoverCategory?
    var captions = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline.weight(.bold)).lineLimit(1).padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 8) {
                    content()
                    // In fondo alla riga, grande come una locandina: apre tutti i titoli della categoria.
                    if let all {
                        NavigationLink(value: all) { SeeAllTile(captions: captions) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

private struct SeeAllTile: View {
    let captions: Bool
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                Image(systemName: "arrow.right").font(.title3.weight(.semibold))
                    .frame(width: 38, height: 38).overlay(Circle().stroke(.secondary, lineWidth: 2))
                Text("Guarda tutto").font(.footnote.weight(.bold))
            }
            .frame(width: 112, height: 168)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner(8)))
            if captions { Color.clear.frame(width: 112, height: 38) }
        }
    }
}

/// Un riquadro che pulsa al posto di un contenuto in arrivo.
private struct Pulse: ViewModifier {
    @State private var dim = false
    func body(content: Content) -> some View {
        content.opacity(dim ? 0.45 : 1)
            .onAppear { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true } }
    }
}

private struct SkeletonRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(Theme.card).frame(width: 160, height: 18)
            HStack(spacing: 8) { ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: 8).fill(Theme.card).frame(width: 112, height: 168) } }
        }
        .padding(.horizontal)
        .modifier(Pulse())
    }
}

/// Cosa si sta caricando, sempre in vista in alto a destra.
struct LoadingBadge: View {
    @EnvironmentObject var model: AppModel
    var extra: String?
    var body: some View {
        let text: String? = model.moviesLoading && model.movies == nil ? "Carico i film…"
            : model.seriesLoading && model.series == nil ? "Carico le serie…"
            : model.catalogUpdating > 0 ? "Cerco titoli nuovi…"
            : model.tmdbLoading ? extra : nil
        if let text {
            HStack(spacing: 8) { ProgressView().tint(.white).controlSize(.small); Text(text) }
                .font(.footnote.weight(.semibold)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 7).background(.black.opacity(0.85), in: Capsule())
                .padding(.trailing, 12).padding(.top, 4)
        }
    }
}

/// Con la chiave TMDB: film e serie aggiunti con +, in una pagina tutta loro e nell'ordine in cui li hai aggiunti.
struct MyListView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        let _ = model.positionsVersion
        let mm: [DiscoverTitle] = model.movieEntries(myListId).map { DiscoverTitle(movie: $0) }
        let ms: [DiscoverTitle] = model.seriesEntries(myListId).map { DiscoverTitle(show: $0) }
        let list = mm + ms
        Group {
            if model.movies == nil && model.series == nil {
                LoadingView(text: "Caricamento della tua lista…")
            } else if list.isEmpty {
                VStack(spacing: 8) {
                    Text("La lista è vuota").font(.headline)
                    Text("Aggiungi film e serie con + dalla loro scheda.").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 8, alignment: .top)], spacing: 14) {
                        ForEach(list) { PosterTile(title: $0, lookup: true, caption: true) }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("La mia lista")
        .navigationDestination(for: TitleEntry<Movie>.self) { MovieDetail(entry: $0) }
        .navigationDestination(for: TitleEntry<Series>.self) { SeriesDetail(entry: $0) }
        .task { await model.ensureMovies(); await model.ensureSeries() }
    }
}

/// La scheda TMDB già nota, altrimenti chiesta a TMDB quando il riquadro compare.
private struct CardLoader: ViewModifier {
    @EnvironmentObject var model: AppModel
    let title: DiscoverTitle
    let enabled: Bool
    @Binding var card: Tmdb.Card?

    func body(content: Content) -> some View {
        content.task(id: title.id) {
            card = title.card
            if card == nil && enabled { card = await Tmdb.lookup(model.tmdbKey, title.kind, title.name, title.year) }
        }
    }
}

private struct PosterTile: View {
    @EnvironmentObject var model: AppModel
    let title: DiscoverTitle
    var lookup = false
    var caption = false
    @State private var card: Tmdb.Card?

    var body: some View {
        let progress = title.movie.map { $0.variants.map { model.positions.progress($0.key) }.max() ?? 0 } ?? 0
        TitleLink(title: title) {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: Tmdb.img((card ?? title.card)?.poster) ?? title.poster, placeholder: TextHelpers.initials(title.name))
                    .frame(width: 112, height: 168)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.corner(8)))
                    .overlay(alignment: .topLeading) {
                        if !title.isMovie && !caption {
                            Text("SERIE").font(.system(size: 9, weight: .heavy)).kerning(1).padding(.horizontal, 5).padding(.vertical, 2)
                                .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 4)).padding(6)
                        }
                    }
                    .overlay(alignment: .bottom) { if progress > 0 && progress < 1 { ProgressLine(value: progress).padding(6) } }
                if caption { Text(title.name).font(.caption).foregroundStyle(.secondary).lineLimit(2).frame(width: 112, alignment: .leading) }
            }
        }
        .modifier(CardLoader(title: title, enabled: lookup, card: $card))
    }
}

private struct TopTile: View {
    let title: DiscoverTitle
    let rank: Int

    var body: some View {
        TitleLink(title: title) {
            HStack(alignment: .bottom, spacing: -18) {
                Text("\(rank)").font(.system(size: 130, weight: .black)).foregroundStyle(Color.black)
                    .shadow(color: .gray, radius: 0, x: 1, y: 1).shadow(color: .gray, radius: 0, x: -1, y: -1)
                    .frame(height: 150, alignment: .bottom)
                RemoteImage(url: Tmdb.img(title.card?.poster) ?? title.poster, placeholder: TextHelpers.initials(title.name))
                    .frame(width: 100, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.corner(8)))
            }
        }
    }
}

/// Continua a guardare: la scena del titolo con l'avanzamento, come fanno i servizi di streaming.
private struct WideTile: View {
    @EnvironmentObject var model: AppModel
    let title: DiscoverTitle
    @State private var card: Tmdb.Card?

    var body: some View {
        let progress = title.movie.map { $0.variants.map { model.positions.progress($0.key) }.max() ?? 0 } ?? 0
        TitleLink(title: title) {
            VStack(alignment: .leading, spacing: 4) {
                RemoteImage(url: Tmdb.img(card?.backdrop, "w780") ?? title.poster, placeholder: TextHelpers.initials(title.name))
                    .frame(width: 220, height: 124)
                    .overlay(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom))
                    .overlay(alignment: .bottomLeading) {
                        Image(systemName: "play.fill").font(.subheadline).foregroundStyle(.white).frame(width: 34, height: 34)
                            .background(.black.opacity(0.45), in: Circle()).overlay(Circle().stroke(.white, lineWidth: 2)).padding(10)
                    }
                    .overlay(alignment: .bottom) { if progress > 0 && progress < 1 { ProgressLine(value: progress) } }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.corner(8)))
                Text(card?.title.isEmpty == false ? card!.title : title.name).font(.footnote.weight(.semibold)).lineLimit(1)
                Text(title.isMovie ? "Film" : "Serie TV · riprendi l'episodio").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(width: 220)
        }
        .modifier(CardLoader(title: title, enabled: true, card: $card))
    }
}

/// Una categoria della lista: nome e quanti titoli; si apre con tutti i suoi titoli. Vuota, non compare.
private struct CategoryTile: View {
    let category: DiscoverCategory
    let name: String
    let count: Int

    var body: some View {
        if count > 0 {
            NavigationLink(value: category) {
                VStack(alignment: .leading) {
                    HStack {
                        Image(systemName: category.movies ? "film" : "tv").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(count)").font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                }
                .padding(14)
                .frame(maxWidth: .infinity, minHeight: 96, maxHeight: 96, alignment: .leading)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner(12)))
            }
            .buttonStyle(.plain)
        }
    }
}

/// Tutte le categorie della lista, film e serie: si apre quella scelta.
private struct CategoriesPage: View {
    let movies: [Category]
    let series: [Category]

    var body: some View {
        List {
            if !movies.isEmpty {
                Section("Film") {
                    NavigationLink(value: DiscoverCategory(movies: true, id: allId)) { Text("Tutti i film").bold() }
                    ForEach(movies) { c in NavigationLink(value: DiscoverCategory(movies: true, id: c.id)) { Text(c.name) } }
                }
            }
            if !series.isEmpty {
                Section("Serie TV") {
                    NavigationLink(value: DiscoverCategory(movies: false, id: allId)) { Text("Tutte le serie").bold() }
                    ForEach(series) { c in NavigationLink(value: DiscoverCategory(movies: false, id: c.id)) { Text(c.name) } }
                }
            }
        }
        .navigationTitle("Categorie")
    }
}
