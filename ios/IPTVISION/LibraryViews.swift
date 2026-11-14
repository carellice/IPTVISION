import SwiftUI

// MARK: - Categorie di film e serie

struct MovieCategories: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Group {
            if let lib = model.movies {
                CategoryList(categories: lib.categories, total: lib.items.count, counts: { lib.byCategory[$0]?.count ?? 0 })
                    .refreshable { await model.ensureMovies(refresh: true) }
            } else if model.moviesLoading {
                LoadingView(text: "Carico i film…")
            } else {
                ContentUnavailable(text: "Nessun film.") { Task { await model.ensureMovies(refresh: true) } }
            }
        }
        .navigationTitle("Film")
        .navigationDestination(for: String.self) { MovieGrid(categoryId: $0) }
        .navigationDestination(for: TitleEntry<Movie>.self) { MovieDetail(entry: $0) }
        .task { await model.ensureMovies() }
    }
}

struct SeriesCategories: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Group {
            if let lib = model.series {
                CategoryList(categories: lib.categories, total: lib.items.count, counts: { lib.byCategory[$0]?.count ?? 0 })
                    .refreshable { await model.ensureSeries(refresh: true) }
            } else if model.seriesLoading {
                LoadingView(text: "Carico le serie…")
            } else {
                ContentUnavailable(text: "Nessuna serie.") { Task { await model.ensureSeries(refresh: true) } }
            }
        }
        .navigationTitle("Serie TV")
        .navigationDestination(for: String.self) { SeriesGrid(categoryId: $0) }
        .navigationDestination(for: TitleEntry<Series>.self) { SeriesDetail(entry: $0) }
        .task { await model.ensureSeries() }
    }
}

private struct CategoryList: View {
    let categories: [Category]
    let total: Int
    let counts: (String) -> Int
    @State var filter = ""

    var body: some View {
        List {
            if filter.isEmpty {
                NavigationLink(value: continueId) { CategoryRow(title: "Continua a guardare", icon: "clock.arrow.circlepath", count: nil) }
                NavigationLink(value: myListId) { CategoryRow(title: "La mia lista", icon: "bookmark.fill", count: nil) }
                NavigationLink(value: allId) { CategoryRow(title: "Tutti", icon: "square.grid.2x2", count: total) }
            }
            ForEach(categories.filter { filter.isEmpty || TextHelpers.normalize($0.name).contains(TextHelpers.normalize(filter)) }) { c in
                NavigationLink(value: c.id) { CategoryRow(title: c.name, icon: nil, count: counts(c.id)) }
            }
        }
        .searchable(text: $filter, prompt: "Cerca categoria")
    }
}

private func categoryTitle(_ id: String, _ cats: [Category]?) -> String {
    switch id {
    case allId: "Tutti"
    case continueId: "Continua a guardare"
    case myListId: "La mia lista"
    default: cats?.first { $0.id == id }?.name ?? ""
    }
}

// MARK: - Griglie

private let columns = [GridItem(.adaptive(minimum: 110, maximum: 170), spacing: 12)]

struct Poster: View {
    let url: String?
    let title: String
    let subtitle: String
    var progress: Double = 0
    var badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            RemoteImage(url: url, placeholder: TextHelpers.initials(title))
                .aspectRatio(2 / 3, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    if let badge {
                        Text(badge).font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.black.opacity(0.7), in: Capsule()).padding(6)
                    }
                }
                .overlay(alignment: .bottom) { if progress > 0 { ProgressLine(value: progress).padding(6) } }
            Text(title).font(.caption.weight(.semibold)).lineLimit(2)
            if !subtitle.isEmpty { Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }
    }
}

struct MovieGrid: View {
    @EnvironmentObject var model: AppModel
    let categoryId: String
    @State var filter = ""

    var body: some View {
        let _ = model.positionsVersion
        let all = model.movieEntries(categoryId)
        let q = TextHelpers.normalize(filter)
        let list = q.isEmpty ? all : all.filter { $0.item.searchKey.contains(q) }
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(list) { e in
                    NavigationLink(value: e) {
                        Poster(url: e.item.poster, title: e.item.name, subtitle: e.item.meta,
                               progress: e.variants.map { model.positions.progress($0.key) }.max() ?? 0,
                               badge: e.hasVariants ? "\(e.variants.count) versioni" : nil)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { model.toggleMyList(e.item) } label: {
                            model.inMyList(e.item) ? Label("Togli dalla mia lista", systemImage: "bookmark.slash") : Label("Aggiungi alla mia lista", systemImage: "bookmark")
                        }
                        if categoryId == continueId {
                            Button(role: .destructive) { model.removeFromContinue(e.item) } label: { Label("Togli da Continua a guardare", systemImage: "xmark") }
                        }
                    }
                }
            }
            .padding()
        }
        .overlay { if all.isEmpty { Text("Niente da mostrare.").foregroundStyle(.secondary) } }
        .searchable(text: $filter, prompt: "Cerca film")
        .navigationTitle(categoryTitle(categoryId, model.movies?.categories))
        .toolbar { SortMenu(section: .movies) }
    }
}

struct SeriesGrid: View {
    @EnvironmentObject var model: AppModel
    let categoryId: String
    @State var filter = ""

    var body: some View {
        let _ = model.positionsVersion
        let all = model.seriesEntries(categoryId)
        let q = TextHelpers.normalize(filter)
        let list = q.isEmpty ? all : all.filter { $0.item.searchKey.contains(q) }
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(list) { e in
                    NavigationLink(value: e) {
                        Poster(url: e.item.cover, title: e.item.name, subtitle: e.item.meta,
                               badge: e.hasVariants ? "\(e.variants.count) versioni" : nil)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { model.toggleMyList(e.item) } label: {
                            model.inMyList(e.item) ? Label("Togli dalla mia lista", systemImage: "bookmark.slash") : Label("Aggiungi alla mia lista", systemImage: "bookmark")
                        }
                        if categoryId == continueId {
                            Button(role: .destructive) { model.removeFromContinue(e.item) } label: { Label("Togli da Continua a guardare", systemImage: "xmark") }
                        }
                    }
                }
            }
            .padding()
        }
        .overlay { if all.isEmpty { Text("Niente da mostrare.").foregroundStyle(.secondary) } }
        .searchable(text: $filter, prompt: "Cerca serie")
        .navigationTitle(categoryTitle(categoryId, model.series?.categories))
        .toolbar { SortMenu(section: .series) }
    }
}

// MARK: - Dettaglio film

struct MovieDetail: View {
    @EnvironmentObject var model: AppModel
    let entry: TitleEntry<Movie>
    @State var selected: Movie?
    @State var info: VodInfo?

    private var movie: Movie { selected ?? entry.item }

    var body: some View {
        let _ = model.positionsVersion
        let resume = model.positions.resume(movie.key)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    RemoteImage(url: movie.poster, placeholder: TextHelpers.initials(movie.name))
                        .aspectRatio(2 / 3, contentMode: .fit)
                        .frame(width: 130)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(movie.name).font(.title2.bold())
                        Text(TextHelpers.joinMeta(info?.year ?? movie.year, info?.duration, info?.resolution, movie.rating > 0 ? String(format: "★ %.1f", movie.rating) : nil))
                            .font(.subheadline).foregroundStyle(.secondary)
                        if let g = info?.genre { Text(g).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }
                if entry.hasVariants {
                    Picker("Versione", selection: Binding(get: { movie.streamId }, set: { id in selected = entry.variants.first { $0.streamId == id }; info = nil })) {
                        ForEach(entry.variants) { v in Text(TextHelpers.quality(of: v.name) ?? v.name).tag(v.streamId) }
                    }
                    .pickerStyle(.segmented)
                }
                HStack {
                    Button {
                        model.play(.film(movie))
                    } label: {
                        Label(resume > 0 ? "Riprendi da \(TextHelpers.formatTime(resume))" : "Guarda", systemImage: "play.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    if resume > 0 {
                        Button { model.positions.forget(movie.key); model.play(.film(movie)) } label: { Image(systemName: "backward.end.fill") }
                            .buttonStyle(.bordered).accessibilityLabel("Dall'inizio")
                    }
                    Button { model.toggleMyList(movie) } label: { Image(systemName: model.inMyList(movie) ? "bookmark.fill" : "bookmark") }
                        .buttonStyle(.bordered).accessibilityLabel("La mia lista")
                }
                .controlSize(.large)
                if let p = info?.plot { Text(p) }
                if let d = info?.director { Text("Regia: \(d)").font(.subheadline).foregroundStyle(.secondary) }
                if let c = info?.cast { Text("Cast: \(c)").font(.subheadline).foregroundStyle(.secondary) }
            }
            .padding()
            .frame(maxWidth: 800, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: movie.streamId) { info = try? await model.client?.vodInfo(movie.streamId) }
    }
}

// MARK: - Dettaglio serie

struct SeriesDetail: View {
    @EnvironmentObject var model: AppModel
    let entry: TitleEntry<Series>
    @State var selected: Series?
    @State var info: SeriesInfo?
    @State var loading = true
    @State var season = 1

    private var show: Series { selected ?? entry.item }

    var body: some View {
        let _ = model.positionsVersion
        let eps = info?.episodes ?? []
        let seasons = Array(Set(eps.map(\.season))).sorted()
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    RemoteImage(url: show.cover, placeholder: TextHelpers.initials(show.name))
                        .aspectRatio(2 / 3, contentMode: .fit)
                        .frame(width: 130)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(show.name).font(.title2.bold())
                        Text(show.meta).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                if entry.hasVariants {
                    Picker("Versione", selection: Binding(get: { show.seriesId }, set: { id in selected = entry.variants.first { $0.seriesId == id } })) {
                        ForEach(entry.variants) { v in Text(TextHelpers.quality(of: v.name) ?? v.name).tag(v.seriesId) }
                    }
                    .pickerStyle(.segmented)
                }
                HStack {
                    if let next = model.resumeEpisode(eps, series: show.seriesId) {
                        Button { model.playEpisode(show, next, eps) } label: {
                            Label(model.positions.lastEpisode(show.seriesId) == nil ? "Guarda \(next.label)" : "Continua \(next.label)", systemImage: "play.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    Button { model.toggleMyList(show) } label: { Image(systemName: model.inMyList(show) ? "bookmark.fill" : "bookmark") }
                        .buttonStyle(.bordered).accessibilityLabel("La mia lista")
                }
                .controlSize(.large)
                if let p = info?.plot ?? show.plot { Text(p) }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                if seasons.count > 1 {
                    Picker("Stagione", selection: $season) {
                        ForEach(seasons, id: \.self) { Text("Stagione \($0)").tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                ForEach(eps.filter { $0.season == season || seasons.count <= 1 }) { e in
                    Button { model.playEpisode(show, e, eps) } label: { EpisodeRow(episode: e) }.buttonStyle(.plain)
                }
            }
            .padding()
            .frame(maxWidth: 800, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: show.seriesId) {
            loading = true
            info = try? await model.client?.seriesInfo(show.seriesId)
            loading = false
            let eps = info?.episodes ?? []
            season = model.resumeEpisode(eps, series: show.seriesId)?.season ?? eps.first?.season ?? 1
        }
    }
}

struct EpisodeRow: View {
    @EnvironmentObject var model: AppModel
    let episode: Episode

    var body: some View {
        let progress = model.positions.progress(episode.key)
        HStack(spacing: 12) {
            RemoteImage(url: episode.image, placeholder: episode.label)
                .aspectRatio(16 / 9, contentMode: .fill)
                .frame(width: 120, height: 68)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .bottom) { if progress > 0 && progress < 1 { ProgressLine(value: progress).padding(4) } }
            VStack(alignment: .leading, spacing: 3) {
                Text("\(episode.number). \(episode.displayTitle)").font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(episode.durationText).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if model.positions.isWatched(episode.key) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent) }
        }
        .contentShape(Rectangle())
    }
}
