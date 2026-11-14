import SwiftUI

@main
struct IPTVISIONApp: App {
    @StateObject private var model = AppModel()

    init() {
        // Locandine e loghi: cache su disco, così le griglie non le riscaricano a ogni apertura.
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.account == nil { LoginView() } else { HomeView() }
            }
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
    static let accent = Color(red: 0x3D / 255, green: 0x7B / 255, blue: 1)
    static let accent2 = Color(red: 0, green: 0xC2 / 255, blue: 1)
    static let bg = Color(red: 0x0A / 255, green: 0x0B / 255, blue: 0x0F / 255)
    static let card = Color.white.opacity(0.06)
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
                    LinearGradient(colors: [Theme.accent.opacity(0.35), Theme.accent2.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing)
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
                Capsule().fill(.white.opacity(0.15))
                Capsule().fill(Theme.accent).frame(width: g.size.width * min(1, max(0, value)))
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
