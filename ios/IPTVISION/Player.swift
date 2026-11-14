import AVFoundation
import MobileVLCKit
import SwiftUI

/// Motore video libVLC: legge MKV, TS, AC3/DTS e tutti i formati dei pannelli IPTV.
@MainActor
final class Player: ObservableObject {
    let vlc = VLCMediaPlayer()
    @Published var isPlaying = false
    @Published var buffering = true
    @Published var time: Double = 0      // secondi
    @Published var duration: Double = 0  // secondi, 0 per la diretta
    @Published var failed: String?
    @Published var fill = false
    @Published var videoSize: CGSize = .zero

    var onEnded: (() -> Void)?
    private var timer: Timer?
    private var url: URL?
    private var live = false
    private var retries = 0
    private var retryAt: Date?

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        // Lo stato si legge ogni mezzo secondo: più semplice e robusto dei callback di VLCKit.
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    func play(_ url: URL, live: Bool, start: Double) {
        self.url = url
        self.live = live
        retries = 0
        retryAt = nil
        failed = nil
        open(start: start)
    }

    private func open(start: Double) {
        guard let url else { return }
        let media = VLCMedia(url: url)
        var opts = [":http-user-agent=\(XtreamClient.userAgent)", ":network-caching=\(live ? 1500 : 3000)", ":http-reconnect"]
        if start > 0 { opts.append(":start-time=\(Int(start))") }
        opts.forEach { media.addOption($0) }
        vlc.media = media
        time = start
        duration = 0
        buffering = true
        vlc.play()
    }

    func stop() {
        vlc.stop()
        url = nil
    }

    func toggle() { vlc.isPlaying ? vlc.pause() : vlc.play() }

    func seek(to seconds: Double) {
        vlc.time = VLCTime(int: Int32(max(0, seconds) * 1000))
        time = seconds
    }

    func skip(_ seconds: Double) { seek(to: min(max(0, time + seconds), duration > 0 ? duration - 1 : time + seconds)) }

    private func tick() {
        guard url != nil else { return }
        isPlaying = vlc.isPlaying
        let state = vlc.state
        buffering = state == .opening || state == .buffering && !vlc.isPlaying
        if vlc.isPlaying {
            time = Double(vlc.time.intValue) / 1000
            if let len = vlc.media?.length.intValue, len > 0 { duration = Double(len) / 1000 }
            retries = 0
            if vlc.videoSize != videoSize { videoSize = vlc.videoSize }
        }
        switch state {
        case .error, .ended, .stopped:
            if !live && state == .ended { url = nil; onEnded?(); return }
            if !live && state == .stopped { return }
            // La diretta si interrompe? Si riapre da sola, aspettando un po' di più a ogni tentativo.
            if let at = retryAt {
                if Date() >= at { retryAt = nil; open(start: live ? 0 : time) }
            } else if retries < 6 {
                retries += 1
                retryAt = Date().addingTimeInterval(Double(min(retries * 2, 10)))
            } else {
                failed = "Impossibile riprodurre questo contenuto."
            }
        default: break
        }
    }

    // MARK: - Tracce

    struct Track: Identifiable { let id: Int32; let name: String }

    var audioTracks: [Track] { tracks(vlc.audioTrackIndexes, vlc.audioTrackNames) }
    var subtitleTracks: [Track] { tracks(vlc.videoSubTitlesIndexes, vlc.videoSubTitlesNames) }
    var audioTrack: Int32 { get { vlc.currentAudioTrackIndex } set { vlc.currentAudioTrackIndex = newValue; objectWillChange.send() } }
    var subtitleTrack: Int32 { get { vlc.currentVideoSubTitleIndex } set { vlc.currentVideoSubTitleIndex = newValue; objectWillChange.send() } }

    private func tracks(_ ids: [Any]?, _ names: [Any]?) -> [Track] {
        let i = (ids ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
        let n = (names ?? []).map { "\($0)" }
        return zip(i, n).map { Track(id: $0, name: $1) }
    }
}

/// La superficie su cui libVLC disegna il video.
struct VideoSurface: UIViewRepresentable {
    let player: Player
    /// Fattore di zoom per riempire lo schermo tagliando i bordi (1 = immagine intera).
    static func fillScale(video: CGSize, in box: CGSize) -> CGFloat {
        guard video.width > 0, video.height > 0, box.width > 0, box.height > 0 else { return 1 }
        let fit = min(box.width / video.width, box.height / video.height)
        let fill = max(box.width / video.width, box.height / video.height)
        return fill / fit
    }

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .black
        player.vlc.drawable = v
        return v
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
