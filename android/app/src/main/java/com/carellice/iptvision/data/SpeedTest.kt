package com.carellice.iptvision.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Speedtest veloce prima di un canale in diretta, per scegliere la qualità che la connessione regge. */
object SpeedTest {
    /** Senza server di casa si misura Internet di questo dispositivo. */
    private const val INTERNET_URL = "https://speed.cloudflare.com/__down?bytes=50000000"
    private const val TEST_MS = 1500L

    private val http by lazy { XtreamClient.http.newBuilder().callTimeout(6, TimeUnit.SECONDS).build() }

    /** Mb/s di un download, contati dal primo byte e per al massimo 1,5 secondi; null se non riesce. */
    suspend fun download(url: String, token: String? = null): Double? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).apply { if (token != null) header("Authorization", "Bearer $token") }.build()
        val call = http.newCall(req)
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val input = resp.body?.byteStream() ?: return@withContext null
                val buf = ByteArray(64 * 1024)
                if (input.read(buf) < 0) return@withContext null
                val start = System.nanoTime()
                var bytes = 0L
                while (System.nanoTime() - start < TEST_MS * 1_000_000) {
                    val n = input.read(buf)
                    if (n < 0) break
                    bytes += n
                }
                val seconds = (System.nanoTime() - start) / 1e9
                if (seconds > 0.05) bytes * 8 / seconds / 1e6 else null
            }
        } catch (_: Exception) {
            null
        } finally {
            call.cancel()
        }
    }

    /** La velocità che avrà un canale: con il server di casa la più lenta tra Internet del server e la strada dal server a qui. */
    suspend fun live(homeServer: String?, token: String?): Double? {
        if (homeServer == null || token == null) return download(INTERNET_URL)
        return coroutineScope {
            val server = async { try { ServerApi.speed(homeServer, token) } catch (_: Exception) { null } }
            val here = async { download("$homeServer/api/speedtest/down?bytes=50000000", token) }
            listOfNotNull(server.await(), here.await()).minOrNull()
        }
    }
}
