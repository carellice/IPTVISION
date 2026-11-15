import SwiftUI

@main
struct IPTVISIONApp: App {
    @StateObject private var model = AppModel()
    /// Stile grafico: "classic" (moderno), "metro" (Modern UI, Windows Phone), "dueffe" (Dueffe) o "nothing" (Nothing). Si sceglie nelle impostazioni.
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
            .font(Theme.dueffe ? .custom("Inter", size: 17, relativeTo: .body) : Theme.nothing ? .custom("SpaceGrotesk-Regular", size: 17, relativeTo: .body) : .body)
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
    /// Dueffe: fondo quasi nero, superfici calde, avorio e oro, Bricolage Grotesque e Inter (cartella Fonts).
    static var dueffe: Bool { UserDefaults.standard.string(forKey: "skin") == "dueffe" }
    /// Nothing: nero OLED, superfici piatte con linee sottili, bianco come accento e rosso solo per la diretta;
    /// Space Grotesk per il testo, Space Mono maiuscolo per le etichette, Doto a punti per i titoli (cartella Fonts).
    static var nothing: Bool { UserDefaults.standard.string(forKey: "skin") == "nothing" }
    private static let wpBlue = Color(red: 0x1B / 255, green: 0xA1 / 255, blue: 0xE2 / 255)
    private static let gold = Color(red: 1, green: 0xD8 / 255, blue: 0x4D / 255)
    static var accent: Color { nothing ? .white : dueffe ? gold : metro ? wpBlue : Color(red: 0x3D / 255, green: 0x7B / 255, blue: 1) }
    static var accent2: Color { nothing ? Color(white: 0xE8 / 255) : dueffe ? Color(red: 1, green: 0xB8 / 255, blue: 0) : metro ? wpBlue : Color(red: 0, green: 0xC2 / 255, blue: 1) }
    static var bg: Color { nothing ? .black : dueffe ? Color(red: 5 / 255, green: 5 / 255, blue: 5 / 255) : metro ? .black : Color(red: 0x0A / 255, green: 0x0B / 255, blue: 0x0F / 255) }
    static var card: Color { nothing ? Color(white: 0x11 / 255) : dueffe ? Color(red: 0x1A / 255, green: 0x17 / 255, blue: 0x11 / 255) : Color.white.opacity(metro ? 0.12 : 0.06) }
    /// Testo sopra l'accento: scuro sull'oro di Dueffe e sul bianco di Nothing.
    static var onAccent: Color { nothing ? .black : dueffe ? Color(red: 0x16 / 255, green: 0x10 / 255, blue: 6 / 255) : .white }
    /// Raggio degli angoli: zero nello stile Modern UI.
    static func corner(_ r: CGFloat) -> CGFloat { metro ? 0 : dueffe ? r * 1.5 : nothing ? min(r, 16) : r }

    /// Titoli delle barre leggeri come quelli di Windows Phone; nello stile moderno quelli di sistema.
    static func applyAppearance() {
        let bar = UINavigationBar.appearance()
        if nothing {
            bar.largeTitleTextAttributes = [.font: UIFont(name: "Doto-Bold", size: 36) ?? .monospacedSystemFont(ofSize: 34, weight: .bold), .foregroundColor: UIColor.white]
            bar.titleTextAttributes = [.font: UIFont(name: "SpaceMono-Regular", size: 15) ?? .monospacedSystemFont(ofSize: 15, weight: .regular), .kern: 1.2]
        } else if dueffe {
            bar.largeTitleTextAttributes = [.font: UIFont(name: "BricolageGrotesque-24ptExtraBold", size: 34) ?? .systemFont(ofSize: 34, weight: .heavy)]
            bar.titleTextAttributes = [.font: UIFont(name: "BricolageGrotesque-24ptBold", size: 17) ?? .systemFont(ofSize: 17, weight: .bold)]
        } else if metro {
            bar.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 36, weight: .light)]
            bar.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 17, weight: .regular)]
        } else {
            bar.largeTitleTextAttributes = nil
            bar.titleTextAttributes = nil
        }
    }
}

extension View {
    /// Pulsante principale: quello di sistema, o nello stile Dueffe l'oro a gradiente con testo scuro e la molla.
    @ViewBuilder func prominentStyle() -> some View {
        if Theme.dueffe { buttonStyle(GoldButtonStyle()) } else if Theme.nothing { buttonStyle(NothingButtonStyle()) } else { buttonStyle(.borderedProminent) }
    }
}

struct GoldButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("Inter", size: 15).weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 18).padding(.vertical, 12)
            .background(
                LinearGradient(colors: [Theme.accent, Color(red: 1, green: 0xC2 / 255, blue: 0x1A / 255)], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.spring(response: 0.35, dampingFraction: 0.42), value: configuration.isPressed)
    }
}

/// Tasto principale Nothing: pillola bianca piena, testo nero in Space Mono maiuscolo, premuto sbiadisce (niente molla).
struct NothingButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("SpaceMono-Regular", size: 13))
            .textCase(.uppercase)
            .kerning(0.8)
            .foregroundStyle(Color.black)
            .padding(.horizontal, 24).padding(.vertical, 12)
            .frame(minHeight: 44)
            .background(Color.white, in: Capsule())
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
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
