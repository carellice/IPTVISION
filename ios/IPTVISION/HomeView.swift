import SwiftUI

struct HomeView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Group { if Theme.metro { PivotHome() } else { tabs } }
            // Messaggi brevi (es. "12 film nuovi"): in alto, spariscono da soli.
            .overlay(alignment: .top) {
                if let n = model.notice {
                    Text(n).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 10).background(.black.opacity(0.85), in: Capsule())
                        .padding(.top, 8)
                        .task(id: n) { try? await Task.sleep(nanoseconds: 2_500_000_000); model.notice = nil }
                }
            }
    }

    private var tabs: some View {
        TabView {
            ForEach(model.sections) { s in
                NavigationStack { SectionPage(section: s) }
                    .tabItem { Label(s.title, systemImage: s.icon) }
            }
        }
    }
}

/// La pagina di una sezione (con la chiave TMDB film e serie sono una sola, "Film e serie").
struct SectionPage: View {
    let section: AppSection

    var body: some View {
        switch section {
        case .live: LiveCategories()
        case .movies: MovieCategories()
        case .series: SeriesCategories()
        case .discover: DiscoverView()
        case .mylist: MyListView()
        case .search: SearchView()
        case .settings: SettingsView()
        }
    }
}

/// Modern UI (pivot di Windows Phone): nome dell'app in maiuscoletto, le sezioni come grandi voci minuscole
/// (quella aperta in bianco), le pagine che si scorrono di lato col dito o si aprono toccando la voce.
struct PivotHome: View {
    @EnvironmentObject var model: AppModel
    @State private var section: AppSection = .live

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("IPTVISION").font(.system(size: 14, weight: .semibold)).kerning(1).padding(.horizontal, 14).padding(.top, 6)
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .firstTextBaseline, spacing: 20) {
                        ForEach(model.sections) { s in
                            Text(s.pivotTitle)
                                .font(.system(size: 44, weight: .light))
                                .foregroundStyle(s == section ? Color.white : Color.white.opacity(0.4))
                                .id(s)
                                .onTapGesture { withAnimation(.easeOut(duration: 0.3)) { section = s } }
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .onChange(of: section) { s in withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo(s, anchor: .leading) } }
            }
            TabView(selection: $section) {
                ForEach(model.sections) { s in
                    NavigationStack { SectionPage(section: s).navigationBarTitleDisplayMode(.inline) }.tag(s)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .background(Color.black.ignoresSafeArea())
    }
}

extension AppSection {
    /// Voce del pivot: minuscola e corta.
    var pivotTitle: String {
        switch self {
        case .live: "tv"
        case .series: "serie"
        case .discover: "film e serie"
        case .mylist: "la mia lista"
        default: title.lowercased()
        }
    }
}

/// Menu in alto a destra per scegliere l'ordine della lista.
struct SortMenu: View {
    @EnvironmentObject var model: AppModel
    let section: AppSection

    var body: some View {
        Menu {
            Picker("Ordina", selection: Binding(get: { model.sort(section) }, set: { model.setSort(section, $0) })) {
                ForEach(ListSort.options(section)) { Text($0.label).tag($0) }
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
        }
    }
}

/// Una riga dell'elenco categorie con il numero di elementi.
struct CategoryRow: View {
    let title: String
    let icon: String?
    let count: Int?

    var body: some View {
        HStack {
            if let icon { Image(systemName: icon).foregroundStyle(Theme.accent).frame(width: 24) }
            Text(title)
            Spacer()
            if let count { Text("\(count)").foregroundStyle(.secondary).monospacedDigit() }
        }
    }
}

// MARK: - TV in diretta

struct LiveCategories: View {
    @EnvironmentObject var model: AppModel
    @State var filter = ""

    var body: some View {
        Group {
            if let live = model.live {
                List {
                    if filter.isEmpty {
                        NavigationLink(value: favoritesId) { CategoryRow(title: "Preferiti", icon: "star.fill", count: model.favorites.count) }
                        NavigationLink(value: allId) { CategoryRow(title: "Tutti i canali", icon: "list.bullet", count: live.items.count) }
                    }
                    ForEach(live.categories.filter { filter.isEmpty || TextHelpers.normalize($0.name).contains(TextHelpers.normalize(filter)) }) { c in
                        NavigationLink(value: c.id) { CategoryRow(title: c.name, icon: nil, count: live.byCategory[c.id]?.count ?? 0) }
                    }
                }
                .searchable(text: $filter, prompt: "Cerca categoria")
                .refreshable { await model.loadLive(refresh: true) }
            } else if model.liveLoading {
                LoadingView(text: "Carico i canali…")
            } else {
                ContentUnavailable(text: "Nessun canale.") { Task { await model.loadLive(refresh: true) } }
            }
        }
        .navigationTitle("TV in diretta")
        .navigationDestination(for: String.self) { ChannelList(categoryId: $0) }
    }
}

struct ChannelList: View {
    @EnvironmentObject var model: AppModel
    let categoryId: String
    @State var filter = ""

    private var title: String {
        switch categoryId {
        case favoritesId: "Preferiti"
        case allId: "Tutti i canali"
        default: model.live?.categories.first { $0.id == categoryId }?.name ?? ""
        }
    }

    var body: some View {
        let all = model.channels(categoryId)
        let q = TextHelpers.normalize(filter)
        let list = q.isEmpty ? all : all.filter { $0.searchKey.contains(q) }
        List(list) { ch in
            ChannelRow(channel: ch) { model.play(.live(ch, playlist: all)) }
        }
        .listStyle(.plain)
        .overlay { if all.isEmpty { Text(categoryId == favoritesId ? "Tieni premuto un canale per aggiungerlo ai preferiti." : "Nessun canale.").foregroundStyle(.secondary).padding() } }
        .searchable(text: $filter, prompt: "Cerca canale")
        .navigationTitle(title)
        .toolbar { SortMenu(section: .live) }
    }
}

struct ChannelRow: View {
    @EnvironmentObject var model: AppModel
    let channel: Channel
    let action: () -> Void

    var body: some View {
        let nn = model.nowNext(channel)
        Button(action: action) {
            HStack(spacing: 12) {
                RemoteImage(url: channel.logo, placeholder: channel.initials, contentMode: .fit)
                    .frame(width: 56, height: 40)
                    .background(Theme.card)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.corner(8)))
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        if channel.num > 0 { Text("\(channel.num)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                        Text(channel.name).lineLimit(1)
                        if model.favorites.contains(channel.streamId) { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                    }
                    if let now = nn.now {
                        Text(now.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        ProgressLine(value: now.progress(at: Int(Date().timeIntervalSince1970))).frame(maxWidth: 160)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task { await model.loadEpg(channel) }
        .contextMenu {
            Button { model.toggleFavorite(channel) } label: {
                model.favorites.contains(channel.streamId) ? Label("Togli dai preferiti", systemImage: "star.slash") : Label("Aggiungi ai preferiti", systemImage: "star")
            }
        }
        .swipeActions {
            Button { model.toggleFavorite(channel) } label: { Image(systemName: model.favorites.contains(channel.streamId) ? "star.slash" : "star") }
                .tint(.yellow)
        }
    }
}

struct ContentUnavailable: View {
    let text: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Text(text).foregroundStyle(.secondary)
            Button("Riprova", action: retry).prominentStyle()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
