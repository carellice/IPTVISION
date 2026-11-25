import Foundation

/// Speedtest veloce prima di un canale in diretta, per scegliere la qualità che la connessione regge.
enum SpeedTest {
    /// Senza server di casa si misura Internet di questo dispositivo.
    private static let internetUrl = "https://speed.cloudflare.com/__down?bytes=50000000"

    /// Mb/s di un download, contati dal primo byte e per al massimo 1,5 secondi; nil se non riesce.
    static func download(_ url: String, token: String? = nil) async -> Double? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6)
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return await withCheckedContinuation { cont in
            let probe = Probe(cont)
            let session = URLSession(configuration: .ephemeral, delegate: probe, delegateQueue: nil)
            session.dataTask(with: req).resume()
            session.finishTasksAndInvalidate()
        }
    }

    /// La velocità che avrà un canale: con il server di casa la più lenta tra Internet del server e la strada dal server a qui.
    static func live(homeServer: String?, token: String?) async -> Double? {
        guard let homeServer, let token else { return await download(internetUrl) }
        async let server = try? ServerApi.speed(homeServer, token: token)
        async let here = download(homeServer + "/api/speedtest/down?bytes=50000000", token: token)
        let known = [await server ?? nil, await here].compactMap { $0 }
        return known.min()
    }

    /// Conta i byte che arrivano e chiude il download dopo 1,5 secondi dal primo.
    private final class Probe: NSObject, URLSessionDataDelegate {
        private let lock = NSLock()
        private var cont: CheckedContinuation<Double?, Never>?
        private var start: Date?
        private var bytes = 0

        init(_ cont: CheckedContinuation<Double?, Never>) { self.cont = cont }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            lock.lock(); defer { lock.unlock() }
            guard let start else { self.start = Date(); return }
            bytes += data.count
            if Date().timeIntervalSince(start) > 1.5 {
                finish()
                dataTask.cancel()
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            lock.lock(); defer { lock.unlock() }
            if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { start = nil }
            finish()
        }

        /// Da chiamare con il lock preso.
        private func finish() {
            guard let cont else { return }
            self.cont = nil
            let seconds = start.map { Date().timeIntervalSince($0) } ?? 0
            cont.resume(returning: seconds > 0.05 ? Double(bytes) * 8 / seconds / 1e6 : nil)
        }
    }
}
