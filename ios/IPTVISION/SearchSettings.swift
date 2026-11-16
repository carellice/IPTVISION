import SwiftUI

struct SearchView: View {
    @EnvironmentObject var model: AppModel
    @State var query = ""

    var body: some View {
        let r = model.search(query)
        List {
            if query.count < 2 {
                Text("Cerca tra canali, film e serie.").foregroundStyle(.secondary)
                if model.moviesLoading || model.seriesLoading { ProgressView("Carico film e serie…") }
            }
            if !r.channels.isEmpty {
                Section("Canali") {
                    ForEach(r.channels) { ch in ChannelRow(channel: ch) { model.play(.live(ch, playlist: r.channels)) } }
                }
            }
            if !r.movies.isEmpty {
                Section("Film") {
                    ForEach(r.movies) { e in
                        NavigationLink(value: e) { ResultRow(image: e.item.poster, title: e.item.name, meta: e.item.meta) }
                    }
                }
            }
            if !r.series.isEmpty {
                Section("Serie TV") {
                    ForEach(r.series) { e in
                        NavigationLink(value: e) { ResultRow(image: e.item.cover, title: e.item.name, meta: e.item.meta) }
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Titolo o canale")
        .navigationTitle("Cerca")
        .navigationDestination(for: TitleEntry<Movie>.self) { MovieDetail(entry: $0) }
        .navigationDestination(for: TitleEntry<Series>.self) { SeriesDetail(entry: $0) }
        .task {
            // La ricerca copre tutto: carica anche film e serie (dalla cache se già scaricati).
            await model.ensureMovies()
            await model.ensureSeries()
        }
    }
}

private struct ResultRow: View {
    let image: String?
    let title: String
    let meta: String
    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: image, placeholder: TextHelpers.initials(title))
                .frame(width: 44, height: 66).clipShape(RoundedRectangle(cornerRadius: Theme.corner(6)))
            VStack(alignment: .leading) {
                Text(title).lineLimit(2)
                if !meta.isEmpty { Text(meta).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State var adding = false
    @AppStorage("skin") private var skin = "classic"

    private static let dateFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "it_IT")
        f.dateStyle = .medium
        return f
    }()

    var body: some View {
        Form {
            Section("Liste IPTV") {
                ForEach(model.shownLists) { l in
                    let active = model.homeServer == nil ? (model.account.map(l.isSame) ?? false) : l.active == true
                    Button { if !active { model.use(l) } } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(l.alias).foregroundStyle(.primary)
                                Text(l.expiresAt.map { "Scade il " + Self.dateFormat.string(from: Date(timeIntervalSince1970: TimeInterval($0))) } ?? "Nessuna scadenza indicata")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if active { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                        }
                    }
                }
                .onDelete { $0.map { model.shownLists[$0] }.forEach(model.removeList) }
                Button { adding = true } label: { Label("Aggiungi lista", systemImage: "plus") }
            }
            ServerSettingsSection()
            Section {
                Picker("Stile grafico", selection: $skin) {
                    Text("Moderno").tag("classic")
                    Text("Modern UI").tag("metro")
                    Text("Dueffe").tag("dueffe")
                    Text("Nothing").tag("nothing")
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Aspetto")
            } footer: {
                Text(skin == "metro" ? "Lo stile di Windows Phone: nero, piatto, angoli vivi, titoli grandi e sezioni da scorrere in alto."
                     : skin == "nothing" ? "Nero OLED, bianco e un solo rosso, titoli a matrice di punti e etichette in monospazio."
                     : skin == "dueffe" ? "Fondo quasi nero, superfici calde, avorio e oro, titoli in Bricolage Grotesque."
                     : "Lo stile di sempre, con le schede in basso.")
            }
            TmdbSection()
            Section {
                Toggle("Nascondi XXX", isOn: $model.hideAdult)
                Picker("Formato della diretta", selection: $model.outputFormat) {
                    Text("MPEG-TS").tag("ts")
                    Text("HLS (m3u8)").tag("m3u8")
                }
            } header: {
                Text("Visione")
            } footer: {
                Text("Nascondi XXX toglie le categorie con \"XXX\" nel nome. Se un canale non parte, prova l'altro formato.")
            }
            Section {
                Button { Task { await model.refreshAll() } } label: { Label("Aggiorna liste", systemImage: "arrow.clockwise") }
                Button { model.clearCache() } label: { Label("Svuota cache", systemImage: "trash") }
                Button(role: .destructive) { model.logout() } label: { Label("Esci dall'account", systemImage: "rectangle.portrait.and.arrow.right") }
            }
            Section {
                LabeledContent("Versione", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            } footer: {
                Text("IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.")
            }
        }
        .navigationTitle("Impostazioni")
        .task { await model.loadServerLists() }
        .sheet(isPresented: $adding) { LoginView(isSheet: true).environmentObject(model) }
    }
}

/// La chiave TMDB di questo dispositivo: con questa film e serie diventano una sola schermata con copertine, tendenze e generi.
struct TmdbSection: View {
    @EnvironmentObject var model: AppModel
    @State private var value = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Section {
            if model.tmdbKey.isEmpty {
                SecureField("Chiave API o token TMDB", text: $value)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                Button(busy ? "Controllo…" : "Salva chiave") {
                    let k = value.trimmingCharacters(in: .whitespaces)
                    guard !k.isEmpty else { return }
                    busy = true; error = nil
                    Task {
                        do { try await Tmdb.check(k); model.setTmdbKey(k); value = "" } catch { self.error = error.localizedDescription }
                        busy = false
                    }
                }
                .disabled(busy)
            } else {
                LabeledContent("Chiave", value: "Inserita")
                Button("Rimuovi chiave", role: .destructive) { model.setTmdbKey("") }
            }
        } header: {
            Text("TMDB")
        } footer: {
            Text("Con una chiave di themoviedb.org (la \"Chiave API\" o il \"Token di accesso in lettura\" che trovi nel tuo profilo TMDB, alla voce API) film e serie diventano una sola schermata, \"Film e serie\", con copertine, tendenze e generi. Con il server di casa vale per tutti i dispositivi collegati.")
        }
    }
}
