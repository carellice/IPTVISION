package com.carellice.iptvision.data

import android.util.Base64
import android.util.JsonReader
import android.util.JsonToken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class XtreamException(message: String, val isAuthError: Boolean = false, cause: Throwable? = null) : Exception(message, cause)

data class XtreamAccount(val server: String, val username: String, val password: String) {
    val key: String by lazy { hash(server.lowercase() + "|" + username) }

    companion object {
        fun hash(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
    }
}

/** Client per le API "player_api.php" dei pannelli Xtream Codes. */
class XtreamClient(val account: XtreamAccount) {

    companion object {
        const val USER_AGENT = "IPTVISION/1.0"

        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", USER_AGENT).build()) }
            .build()

        /**
         * Accetta "host:porta", "http://host:porta/" o l'intero link M3U
         * (get.php?username=..&password=..) e restituisce server/utente/password separati.
         */
        fun parseServerInput(input: String): Triple<String, String?, String?> {
            var s = input.trim()
            if (s.isEmpty()) return Triple("", null, null)
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            val uri = try { URI(s) } catch (_: Exception) { return Triple(s.trimEnd('/'), null, null) }
            var user: String? = null
            var pass: String? = null
            uri.rawQuery?.split('&')?.forEach { part ->
                val kv = part.split('=', limit = 2)
                if (kv.size != 2) return@forEach
                val v = URLDecoder.decode(kv[1], "UTF-8")
                if (kv[0].equals("username", true)) user = v
                else if (kv[0].equals("password", true)) pass = v
            }
            // Rimuove get.php / player_api.php / xmltv.php dal percorso, tiene eventuali sottocartelle.
            var path = uri.rawPath ?: ""
            val last = path.lastIndexOf('/')
            if (last >= 0 && path.substring(last + 1).endsWith(".php", true)) path = path.substring(0, last)
            val server = "${uri.scheme}://${uri.rawAuthority}$path".trimEnd('/')
            return Triple(server, user, pass)
        }

        private fun q(v: String) = URLEncoder.encode(v, "UTF-8").replace("+", "%20")

        private fun yearOf(year: String?, date: String?, name: String): String? {
            for (s in listOf(year, date)) {
                val t = s?.trim() ?: continue
                if (t.length >= 4) t.substring(0, 4).toIntOrNull()?.let { if (it > 1880) return it.toString() }
            }
            return Regex("\\((19|20)\\d{2}\\)").find(name)?.value?.trim('(', ')')
        }

        private fun ratingOf(m: Map<String, String?>): Double {
            m["rating"]?.toDoubleOrNull()?.let { if (it > 0) return minOf(it, 10.0) }
            m["rating_5based"]?.toDoubleOrNull()?.let { if (it > 0) return minOf(it * 2, 10.0) }
            return 0.0
        }

        private fun nn(s: String?): String? = s?.trim()?.takeIf { it.isNotEmpty() }

        private fun intOf(s: String?): Int? = s?.toIntOrNull() ?: s?.toDoubleOrNull()?.toInt()

        private fun formatDuration(secs: Int): String {
            val h = secs / 3600
            val m = (secs % 3600) / 60
            return if (h > 0) "$h h ${"%02d".format(m)} min" else "$m min"
        }

        private fun decodeB64(s: String?): String? {
            if (s.isNullOrEmpty()) return s
            return try { String(Base64.decode(s, Base64.DEFAULT), Charsets.UTF_8).trim() } catch (_: Exception) { s }
        }

        // ---------- Lettura in streaming: le liste di film possono superare i 50.000 elementi ----------

        /** Legge un array JSON di oggetti piatti (i campi annidati vengono saltati). */
        private fun readFlatArray(input: InputStream, each: (Map<String, String?>) -> Unit) {
            JsonReader(InputStreamReader(input, Charsets.UTF_8)).use { r ->
                r.isLenient = true
                if (r.peek() != JsonToken.BEGIN_ARRAY) return
                r.beginArray()
                while (r.hasNext()) {
                    if (r.peek() != JsonToken.BEGIN_OBJECT) { r.skipValue(); continue }
                    val m = HashMap<String, String?>(24)
                    r.beginObject()
                    while (r.hasNext()) {
                        val name = r.nextName()
                        when (r.peek()) {
                            JsonToken.STRING, JsonToken.NUMBER -> m[name] = r.nextString()
                            JsonToken.BOOLEAN -> m[name] = if (r.nextBoolean()) "1" else "0"
                            else -> r.skipValue()
                        }
                    }
                    r.endObject()
                    each(m)
                }
                r.endArray()
            }
        }

        fun parseCategories(file: File): List<Category> {
            val list = ArrayList<Category>()
            file.inputStream().use { s ->
                readFlatArray(s) { m ->
                    val id = m["category_id"] ?: return@readFlatArray
                    list += Category(id, m["category_name"]?.trim() ?: id)
                }
            }
            return list
        }

        fun parseChannels(file: File): List<Channel> {
            val list = ArrayList<Channel>()
            file.inputStream().use { s ->
                readFlatArray(s) { m ->
                    val id = intOf(m["stream_id"]) ?: return@readFlatArray
                    list += Channel(
                        streamId = id,
                        num = intOf(m["num"]) ?: 0,
                        name = (m["name"] ?: "Canale $id").trim(),
                        logo = nn(m["stream_icon"]),
                        categoryId = m["category_id"],
                        epgId = nn(m["epg_channel_id"]),
                    )
                }
            }
            return list
        }

        fun parseMovies(file: File): List<Movie> {
            val list = ArrayList<Movie>()
            file.inputStream().use { s ->
                readFlatArray(s) { m ->
                    val id = intOf(m["stream_id"]) ?: return@readFlatArray
                    val name = (m["name"] ?: "Film $id").trim()
                    list += Movie(
                        streamId = id,
                        name = name,
                        poster = nn(m["stream_icon"]),
                        categoryId = m["category_id"],
                        extension = nn(m["container_extension"]),
                        year = yearOf(m["year"], m["releasedate"], name),
                        rating = ratingOf(m),
                        added = m["added"]?.toLongOrNull() ?: 0,
                    )
                }
            }
            return list
        }

        fun parseSeries(file: File): List<Series> {
            val list = ArrayList<Series>()
            file.inputStream().use { s ->
                readFlatArray(s) { m ->
                    val id = intOf(m["series_id"]) ?: return@readFlatArray
                    val name = (m["name"] ?: "Serie $id").trim()
                    list += Series(
                        seriesId = id,
                        name = name,
                        cover = nn(m["cover"]),
                        categoryId = m["category_id"],
                        year = yearOf(m["year"], m["releaseDate"] ?: m["release_date"], name),
                        rating = ratingOf(m),
                        plot = nn(m["plot"]),
                        genre = nn(m["genre"]),
                    )
                }
            }
            return list
        }

        private fun JSONObject.str(name: String): String? {
            if (!has(name) || isNull(name)) return null
            return when (val v = get(name)) {
                is String -> v
                is Number -> v.toString()
                is Boolean -> if (v) "1" else "0"
                else -> null
            }
        }
    }

    private fun apiUrl(action: String?, extra: String? = null): String {
        val sb = StringBuilder("${account.server}/player_api.php?username=${q(account.username)}&password=${q(account.password)}")
        if (action != null) sb.append("&action=").append(action)
        if (extra != null) sb.append('&').append(extra)
        return sb.toString()
    }

    val xmltvUrl get() = "${account.server}/xmltv.php?username=${q(account.username)}&password=${q(account.password)}"

    fun liveUrl(streamId: Int, ext: String) = "${account.server}/live/${q(account.username)}/${q(account.password)}/$streamId.$ext"
    fun movieUrl(streamId: Int, ext: String) = "${account.server}/movie/${q(account.username)}/${q(account.password)}/$streamId.$ext"
    fun episodeUrl(id: String, ext: String) = "${account.server}/series/${q(account.username)}/${q(account.password)}/${q(id)}.$ext"

    suspend fun authenticate(): AuthInfo {
        val text = getText(apiUrl(null), 15)
        val root = try { JSONObject(text) } catch (e: Exception) {
            throw XtreamException("Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.", cause = e)
        }
        val ui = root.optJSONObject("user_info")
            ?: throw XtreamException("Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.")
        if (intOf(ui.str("auth")) != 1) throw XtreamException("Nome utente o password non corretti.", isAuthError = true)
        val status = ui.str("status")
        if (status != null && !status.equals("Active", true)) throw XtreamException("Account non attivo (stato: $status).", isAuthError = true)
        return AuthInfo(status, ui.str("exp_date")?.toLongOrNull()?.takeIf { it > 0 }, intOf(ui.str("max_connections")) ?: 0)
    }

    /** Scarica una lista (canali, film, serie, categorie) direttamente su file: si legge poi in streaming. */
    suspend fun download(action: String, target: File, timeoutSec: Long) {
        val tmp = File(target.path + ".part")
        withRetry {
            val call = http.newBuilder().callTimeout(timeoutSec, TimeUnit.SECONDS).build()
                .newCall(Request.Builder().url(apiUrl(action)).build())
            call.execute().use { resp ->
                checkResponse(resp.code)
                val body = resp.body ?: throw IOException("Risposta vuota")
                tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
            }
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) throw XtreamException("Impossibile salvare la lista sul dispositivo.")
        }
    }

    suspend fun vodInfo(streamId: Int): VodInfo? {
        val root = JSONObject(getText(apiUrl("get_vod_info", "vod_id=$streamId"), 20))
        val info = root.optJSONObject("info") ?: return null
        val secs = intOf(info.str("duration_secs")) ?: 0
        return VodInfo(
            plot = nn(info.str("plot") ?: info.str("description")),
            genre = nn(info.str("genre")),
            year = yearOf(info.str("year"), info.str("releasedate"), ""),
            duration = if (secs > 0) formatDuration(secs) else nn(info.str("duration")),
            director = nn(info.str("director")),
            cast = nn(info.str("cast") ?: info.str("actors")),
        )
    }

    suspend fun seriesInfo(seriesId: Int): SeriesInfo {
        val root = JSONObject(getText(apiUrl("get_series_info", "series_id=$seriesId"), 30))
        val episodes = ArrayList<Episode>()
        // Alcuni pannelli restituiscono { "1": [...], "2": [...] }, altri [[...], [...]].
        val groups = ArrayList<JSONArray>()
        when (val eps = root.opt("episodes")) {
            is JSONObject -> eps.keys().forEach { k -> eps.optJSONArray(k)?.let(groups::add) }
            is JSONArray -> for (i in 0 until eps.length()) eps.optJSONArray(i)?.let(groups::add)
        }
        for (g in groups) for (i in 0 until g.length()) {
            val e = g.optJSONObject(i) ?: continue
            val id = e.str("id")?.takeIf { it.isNotEmpty() } ?: continue
            val info = e.optJSONObject("info")
            episodes += Episode(
                id = id,
                seriesId = seriesId,
                season = intOf(e.str("season")) ?: 1,
                number = intOf(e.str("episode_num")) ?: 0,
                title = (e.str("title") ?: "").trim(),
                extension = nn(e.str("container_extension")) ?: "mp4",
                durationSecs = info?.let { intOf(it.str("duration_secs")) } ?: 0,
                plot = info?.let { nn(it.str("plot")) },
                image = info?.let { nn(it.str("movie_image")) },
            )
        }
        val si = root.optJSONObject("info")
        return SeriesInfo(
            plot = si?.let { nn(it.str("plot")) },
            genre = si?.let { nn(it.str("genre")) },
            year = si?.let { yearOf(it.str("year"), it.str("releaseDate") ?: it.str("release_date"), "") },
            cast = si?.let { nn(it.str("cast")) },
            episodes = episodes.sortedWith(compareBy({ it.season }, { it.number })),
        )
    }

    /** EPG breve di un singolo canale: usato quando xmltv.php non copre il canale. */
    suspend fun shortEpg(streamId: Int): List<Programme> {
        val root = JSONObject(getText(apiUrl("get_short_epg", "stream_id=$streamId&limit=6"), 15))
        val arr = root.optJSONArray("epg_listings") ?: return emptyList()
        val list = ArrayList<Programme>()
        for (i in 0 until arr.length()) {
            val e = arr.optJSONObject(i) ?: continue
            val st = e.str("start_timestamp")?.toLongOrNull() ?: continue
            val sp = e.str("stop_timestamp")?.toLongOrNull() ?: continue
            list += Programme(st, sp, decodeB64(e.str("title")) ?: "", decodeB64(e.str("description")))
        }
        return list.sortedBy { it.start }
    }

    private fun checkResponse(code: Int) {
        if (code == 401 || code == 403) throw XtreamException("Accesso negato dal server (credenziali errate o account scaduto).", isAuthError = true)
        if (code !in 200..299) throw IOException("HTTP $code")
    }

    private suspend fun getText(url: String, timeoutSec: Long): String = withRetry {
        val call = http.newBuilder().callTimeout(timeoutSec, TimeUnit.SECONDS).build().newCall(Request.Builder().url(url).build())
        call.execute().use { resp ->
            checkResponse(resp.code)
            resp.body?.string() ?: throw IOException("Risposta vuota")
        }
    }

    private suspend fun <T> withRetry(block: () -> T): T {
        var last: Exception? = null
        repeat(3) { attempt ->
            try {
                return withContext(Dispatchers.IO) { block() }
            } catch (e: XtreamException) {
                throw e
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                last = e
                Log.w("Richiesta API fallita (tentativo ${attempt + 1})", e)
                if (attempt < 2) delay(500L * (attempt + 1))
            }
        }
        throw XtreamException("Impossibile contattare il server. Controlla la connessione.", cause = last)
    }
}

object Log {
    fun i(msg: String) {
        android.util.Log.i("IPTVISION", msg)
    }

    fun w(msg: String, e: Throwable? = null) {
        android.util.Log.w("IPTVISION", msg, e)
    }
}
