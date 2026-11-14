import SwiftUI

struct PlayerView: View {
    @EnvironmentObject var model: AppModel
    @StateObject var player = Player()
    @State var controls = true
    @State var hideTask: Task<Void, Never>?
    @State var scrub: Double?
    @State var countdown: Int?

    private var isLive: Bool {
        guard case .live? = model.playing else { return false }
        return true
    }

    var body: some View {
        GeometryReader { g in
            ZStack {
                Color.black.ignoresSafeArea()
                VideoSurface(player: player)
                    .scaleEffect(player.fill ? VideoSurface.fillScale(video: player.videoSize, in: g.size) : 1)
                    .clipped()
                    .ignoresSafeArea()
                if player.buffering && player.failed == nil { ProgressView().controlSize(.large).tint(.white) }
                if let f = player.failed {
                    VStack(spacing: 12) {
                        Text(f).foregroundStyle(.white)
                        Button("Riprova") { start() }.buttonStyle(.borderedProminent)
                    }
                }
                Color.clear.contentShape(Rectangle())
                    .onTapGesture { controls.toggle(); scheduleHide() }
                    .gesture(DragGesture(minimumDistance: 40).onEnded { v in
                        // Diretta: scorri a sinistra/destra per cambiare canale.
                        guard isLive, abs(v.translation.width) > abs(v.translation.height) else { return }
                        model.zap(v.translation.width < 0 ? 1 : -1)
                    })
                if controls { overlay.transition(.opacity) }
                if let c = countdown { nextEpisodeBanner(c) }
            }
        }
        .statusBarHidden(!controls)
        .persistentSystemOverlays(.hidden)
        .animation(.easeInOut(duration: 0.2), value: controls)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            player.onEnded = { ended() }
            model.savePlayingPosition = { savePosition() }
            start()
            scheduleHide()
        }
        .onDisappear {
            savePosition()
            model.savePlayingPosition = nil
            player.stop()
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .onChange(of: model.playing) { _ in start() }
        .onReceive(Timer.publish(every: 10, on: .main, in: .common).autoconnect()) { _ in savePosition() }
    }

    // MARK: - Comandi

    private var overlay: some View {
        VStack {
            HStack(alignment: .top) {
                Button { close() } label: { Image(systemName: "xmark").font(.title2.bold()).padding(10) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.playing?.title ?? "").font(.headline).lineLimit(1)
                    if case .live(let ch, _)? = model.playing, let now = model.nowNext(ch).now {
                        Text("\(now.timeRange)  \(now.title)").font(.caption).lineLimit(1).opacity(0.8)
                    }
                }
                Spacer()
                tracksMenu
                Button { player.fill.toggle() } label: {
                    Image(systemName: player.fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right").font(.title3).padding(10)
                }
            }
            Spacer()
            HStack(spacing: 48) {
                if isLive {
                    Button { model.zap(-1) } label: { Image(systemName: "backward.end.fill").font(.title) }
                } else {
                    Button { player.skip(-10); scheduleHide() } label: { Image(systemName: "gobackward.10").font(.title) }
                }
                Button { player.toggle(); scheduleHide() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 44))
                }
                if isLive {
                    Button { model.zap(1) } label: { Image(systemName: "forward.end.fill").font(.title) }
                } else {
                    Button { player.skip(30); scheduleHide() } label: { Image(systemName: "goforward.30").font(.title) }
                }
            }
            Spacer()
            if !isLive && player.duration > 0 {
                VStack(spacing: 4) {
                    Slider(value: Binding(get: { scrub ?? player.time }, set: { scrub = $0; scheduleHide() }),
                           in: 0...max(1, player.duration),
                           onEditingChanged: { editing in
                               if !editing, let s = scrub { player.seek(to: s); scrub = nil }
                           })
                    HStack {
                        Text(TextHelpers.formatTime(scrub ?? player.time))
                        Spacer()
                        if model.nextEpisode() != nil {
                            Button("Episodio successivo") { savePosition(); model.playNextEpisode() }.font(.caption.bold())
                            Spacer()
                        }
                        Text("-" + TextHelpers.formatTime(player.duration - (scrub ?? player.time)))
                    }
                    .font(.caption.monospacedDigit())
                }
            }
        }
        .foregroundStyle(.white)
        .padding()
        .contentShape(Rectangle())
        .onTapGesture { controls = false }
        .background(LinearGradient(colors: [.black.opacity(0.7), .clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private var tracksMenu: some View {
        Menu {
            let audio = player.audioTracks
            if audio.count > 1 {
                Section("Audio") {
                    ForEach(audio) { t in
                        Button { player.audioTrack = t.id } label: {
                            if player.audioTrack == t.id { Label(t.name, systemImage: "checkmark") } else { Text(t.name) }
                        }
                    }
                }
            }
            let subs = player.subtitleTracks
            if !subs.isEmpty {
                Section("Sottotitoli") {
                    ForEach(subs) { t in
                        Button { player.subtitleTrack = t.id } label: {
                            if player.subtitleTrack == t.id { Label(t.name, systemImage: "checkmark") } else { Text(t.name) }
                        }
                    }
                }
            }
            if audio.count <= 1 && subs.isEmpty { Text("Nessuna traccia alternativa") }
        } label: {
            Image(systemName: "captions.bubble").font(.title3).padding(10)
        }
    }

    private func nextEpisodeBanner(_ c: Int) -> some View {
        VStack {
            Spacer()
            HStack {
                Text("Episodio successivo tra \(c) s").foregroundStyle(.white)
                Button("Annulla") { countdown = nil; close() }.buttonStyle(.bordered)
                Button("Guarda ora") { countdown = nil; model.playNextEpisode() }.buttonStyle(.borderedProminent)
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
            .padding(.bottom, 40)
        }
    }

    // MARK: - Logica

    private func start() {
        guard let p = model.playing, let url = model.url(for: p) else { return }
        countdown = nil
        player.play(url, live: isLive, start: model.resumePoint(for: p, fromStart: false))
        if case .live(let ch, _) = p { Task { await model.loadEpg(ch) } }
    }

    private func savePosition() {
        guard let p = model.playing, !isLive, player.duration > 0 else { return }
        model.savePosition(p, position: player.time, duration: player.duration)
    }

    private func close() {
        savePosition()
        model.playing = nil
    }

    /// Fine del film o dell'episodio: segna visto; alla fine di un episodio parte il successivo dopo 10 secondi.
    private func ended() {
        guard let p = model.playing else { return }
        model.markWatched(p)
        guard model.nextEpisode() != nil else { model.playing = nil; return }
        countdown = 10
        Task { @MainActor in
            while let c = countdown, c > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let c2 = countdown else { return }
                countdown = c2 - 1
            }
            if countdown == 0 { countdown = nil; model.playNextEpisode() }
        }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled && player.isPlaying && scrub == nil { controls = false }
        }
    }
}
