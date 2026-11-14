import SwiftUI

@main
struct IPTVISIONApp: App {
    @StateObject private var model = AppModel()
    /// Stile grafico: "classic" (moderno) o "metro" (Modern UI, Windows Phone). Si sceglie nelle impostazioni.
    @AppStorage("skin") private var skin = "classic"

    init() {
        // Locandine e loghi: cache su disco, così le griglie non le riscaricano a ogni apertura.
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        Theme.applyAppearance()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.account == nil { LoginView() } else { HomeView() }
            }
            // Cambiando stile si ricostruisce tutto con i colori nuovi.
            .id(skin)
            .onChange(of: skin) { _ in Theme.applyAppearance() }
            .environmentObject(model)
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
            .fullScreenCover(isPresented: Binding(get: { model.playing != nil }, set: { if !$0 { model.playing = nil } })) {
                PlayerView().environmentObject(model)
            }
            .alert("Errore", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.error ?? "")
            }
        }
    }
}

enum Theme {
    /// Modern UI: nero, un solo blu pieno, angoli vivi, titoli leggeri e sezioni come voci del pivot (HomeView).
    static var metro: Bool { UserDefaults.standard.string(forKey: "skin") == "metro" }
    private static let wpBlue = Color(red: 0x1B / 255, green: 0xA1 / 255, blue: 0xE2 / 255)
    static var accent: Color { metro ? wpBlue : Color(red: 0x3D / 255, green: 0x7B / 255, blue: 1) }
    static var accent2: Color { metro ? wpBlue : Color(red: 0, green: 0xC2 / 255, blue: 1) }
    static var bg: Color { metro ? .black : Color(red: 0x0A / 255, green: 0x0B / 255, blue: 0x0F / 255) }
    static var card: Color { Color.white.opacity(metro ? 0.12 : 0.06) }
    /// Raggio degli angoli: zero nello stile Modern UI.
    static func corner(_ r: CGFloat) -> CGFloat { metro ? 0 : r }

    /// Titoli delle barre leggeri come quelli di Windows Phone; nello stile moderno quelli di sistema.
    static func applyAppearance() {
        let bar = UINavigationBar.appearance()
        if metro {
            bar.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 36, weight: .light)]
            bar.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 17, weight: .regular)]
        } else {
            bar.largeTitleTextAttributes = nil
            bar.titleTextAttributes = nil
        }
    }
}

/// Immagine da Internet con le iniziali al posto del logo mancante.
struct RemoteImage: View {
    let url: String?
    let placeholder: String
    var contentMode: ContentMode = .fill

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            if let img = phase.image {
                img.resizable().aspectRatio(contentMode: contentMode)
            } else {
                ZStack {
                    if Theme.metro { Theme.accent } else {
                        LinearGradient(colors: [Theme.accent.opacity(0.35), Theme.accent2.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    }
                    Text(placeholder).font(.headline.bold()).foregroundStyle(.white.opacity(0.85)).padding(4).minimumScaleFactor(0.5)
                }
            }
        }
    }
}

/// Barra di avanzamento sottile (programma in onda, punto raggiunto in un film).
struct ProgressLine: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: Theme.corner(1.5)).fill(.white.opacity(0.15))
                RoundedRectangle(cornerRadius: Theme.corner(1.5)).fill(Theme.accent).frame(width: g.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 3)
    }
}

struct LoadingView: View {
    let text: String
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
