package com.carellice.iptvision.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/**
 * TMDB (themoviedb.org): copertine, tendenze e generi per la schermata "Film e serie".
 * Il catalogo resta quello del provider: TMDB sceglie e veste solo i titoli che ci sono.
 * Stessa logica di PWA/web/src/lib/tmdb.ts.
 */
object Tmdb {
    enum class Kind { Movie, Tv }

    data class Card(
        val id: Int, val kind: Kind, val title: String, val year: String?, val overview: String,
        val poster: String?, val backdrop: String?, val vote: Double, val keys: List<String>,
    )

    data class Row(val id: String, val title: String, val items: List<Card>, val top: Boolean = false)

    class TmdbException(message: String) : IOException(message)

    // shortcut: risposte tenute solo in memoria (a ogni avvio ~60 richieste), usare un file se TMDB inizia a limitare.
    private val cache = HashMap<String, JSONObject>()
    // Al massimo 6 richieste insieme: la schermata ne chiede ~60 e TMDB risponde 429 alle raffiche.
    private val slots = Semaphore(6)

    fun clearCache() = synchronized(cache) { cache.clear() }

    private suspend fun get(key: String, path: String, params: Map<String, Any> = emptyMap()): JSONObject {
        // I token v4 sono JWT ("eyJ..."), le chiavi v3 sono 32 caratteri esadecimali.
        val bearer = key.startsWith("eyJ")
        val url = "https://api.themoviedb.org/3/$path".toHttpUrl().newBuilder().apply {
            addQueryParameter("language", "it-IT")
            params.forEach { (k, v) -> addQueryParameter(k, v.toString()) }
            if (!bearer) addQueryParameter("api_key", key)
        }.build()
        val id = url.toString()
        synchronized(cache) { cache[id] }?.let { return it }
        val req = Request.Builder().url(url).apply { if (bearer) header("Authorization", "Bearer $key") }.build()
        val json = slots.withPermit { fetch(req) }
        synchronized(cache) { cache[id] = json }
        return json
    }

    private suspend fun fetch(req: Request, tries: Int = 3): JSONObject {
        val (code, retry, body) = withContext(Dispatchers.IO) {
            try {
                XtreamClient.http.newCall(req).execute().use { Triple(it.code, it.header("Retry-After"), if (it.isSuccessful) it.body!!.string() else null) }
            } catch (e: IOException) { throw TmdbException("TMDB non raggiungibile.") }
        }
        // Troppe richieste insieme: si aspetta quanto dice TMDB (o un secondo) e si riprova.
        if (code == 429 && tries > 0) { delay((retry?.toLongOrNull() ?: 1) * 1000); return fetch(req, tries - 1) }
        if (code == 401) throw TmdbException("Chiave TMDB non valida.")
        if (body == null) throw TmdbException("TMDB: errore $code")
        return try { JSONObject(body) } catch (e: org.json.JSONException) { throw TmdbException("TMDB: risposta non valida") }
    }

    /** Lancia l'eccezione col motivo se la chiave non funziona. */
    suspend fun check(key: String) { get(key.trim(), "configuration") }

    fun img(path: String?, size: String = "w342"): String? = path?.let { "https://image.tmdb.org/t/p/$size$it" }

    private val years = Regex("""\b(19|20)\d\d\b""")

    /** Lo stesso titolo, qualunque cosa abbia aggiunto il pannello: prefisso di lingua, sigle di qualità, anno. */
    fun matchKey(name: String) = TextHelpers.variantKey(name).replace(years, " ").replace(Regex("\\s+"), " ").trim()

    private fun card(o: JSONObject, kind: Kind?): Card? {
        val k = kind ?: when (o.optString("media_type")) { "movie" -> Kind.Movie; "tv" -> Kind.Tv; else -> return null }
        val title = o.optString("title").ifEmpty { o.optString("name") }
        val original = o.optString("original_title").ifEmpty { o.optString("original_name") }
        val date = o.optString("release_date").ifEmpty { o.optString("first_air_date") }
        fun str(n: String) = if (o.isNull(n)) null else o.optString(n).ifEmpty { null }
        return Card(
            o.getInt("id"), k, title, date.take(4).ifEmpty { null }, o.optString("overview"),
            str("poster_path"), str("backdrop_path"), o.optDouble("vote_average", 0.0),
            listOf(matchKey(title), matchKey(original)).filter { it.isNotEmpty() }.distinct(),
        )
    }

    private fun cards(o: JSONObject, kind: Kind?): List<Card> {
        val a = o.optJSONArray("results") ?: return emptyList()
        return (0 until a.length()).mapNotNull { card(a.getJSONObject(it), kind) }
    }

    // ---------- Il catalogo del provider, ritrovabile per titolo ----------

    class Index(val movies: Map<String, Entry<Movie>>, val series: Map<String, Entry<Series>>)

    fun index(movies: List<Movie>, series: List<Series>): Index {
        fun <T> byKey(entries: List<Entry<T>>, name: (T) -> String): Map<String, Entry<T>> {
            val m = HashMap<String, Entry<T>>()
            for (e in entries) { val k = matchKey(name(e.item)); if (k.isNotEmpty() && k !in m) m[k] = e }
            return m
        }
        return Index(byKey(groupVariants(movies) { it.variantKey }) { it.name }, byKey(groupVariants(series) { it.variantKey }) { it.name })
    }

    /** I remake hanno lo stesso titolo: gli anni devono coincidere (±1) quando ci sono entrambi. */
    private fun yearsClose(a: String?, b: String?): Boolean {
        val x = a?.take(4)?.toIntOrNull() ?: return true
        val y = b?.toIntOrNull() ?: return true
        return kotlin.math.abs(x - y) <= 1
    }

    /** Il titolo del catalogo per la scheda TMDB: Entry<Movie> o Entry<Series>, oppure null. */
    fun find(c: Card, index: Index): Entry<*>? {
        for (k in c.keys) {
            if (c.kind == Kind.Movie) index.movies[k]?.let { if (yearsClose(it.item.year, c.year)) return it }
            else index.series[k]?.let { if (yearsClose(it.item.year, c.year)) return it }
        }
        return null
    }

    // ---------- Le righe della schermata ----------

    private data class Source(val kind: Kind, val path: String, val params: Map<String, Any> = emptyMap())

    private fun pages(s: Source, n: Int) = (1..n).map { s.copy(params = s.params + ("page" to it)) }

    private fun discover(kind: Kind, genre: Int) = Source(kind, "discover/${if (kind == Kind.Movie) "movie" else "tv"}",
        mapOf("with_genres" to genre, "sort_by" to "popularity.desc", "vote_count.gte" to if (kind == Kind.Movie) 150 else 60))

    /** Titolo, genere dei film, genere delle serie (TMDB ha due elenchi di generi diversi). */
    private val genres = listOf<Triple<String, Int?, Int?>>(
        Triple("Azione e avventura", 28, 10759), Triple("Commedie", 35, 35), Triple("Fantascienza e fantasy", 878, 10765),
        Triple("Crime", 80, 80), Triple("Thriller e mistero", 53, 9648), Triple("Drammi", 18, 18), Triple("Animazione", 16, 16),
        Triple("Horror", 27, null), Triple("Romantici", 10749, null), Triple("Per tutta la famiglia", 10751, 10751), Triple("Documentari", 99, 99),
    )

    private data class Def(val id: String, val title: String, val sources: List<Source>, val top: Boolean = false)

    private val defs = listOf(
        Def("top", "Top 10 di oggi", pages(Source(Kind.Movie, "trending/all/day"), 3), top = true),
        Def("trend", "Di tendenza questa settimana", pages(Source(Kind.Movie, "trending/all/week"), 3)),
        Def("popm", "Film popolari", pages(Source(Kind.Movie, "movie/popular"), 3)),
        Def("popt", "Serie TV popolari", pages(Source(Kind.Tv, "tv/popular"), 3)),
        Def("best", "I più acclamati", pages(Source(Kind.Movie, "movie/top_rated"), 3) + pages(Source(Kind.Tv, "tv/top_rated"), 3)),
    ) + genres.map { (title, m, t) ->
        Def("g:$title", title, (m?.let { pages(discover(Kind.Movie, it), 2) } ?: emptyList()) + (t?.let { pages(discover(Kind.Tv, it), 2) } ?: emptyList()))
    }

    /** Film e serie affiancati: il primo dell'una, il primo dell'altra e così via. */
    private fun <T> interleave(a: List<T>, b: List<T>): List<T> = buildList {
        for (i in 0 until maxOf(a.size, b.size)) { if (i < a.size) add(a[i]); if (i < b.size) add(b[i]) }
    }

    suspend fun loadRows(key: String): List<Row> = coroutineScope {
        defs.map { d ->
            async {
                val answers = d.sources.map { s ->
                    async {
                        // trending/all mescola i due: il tipo arriva con ogni risultato.
                        try { cards(get(key, s.path, s.params), if (s.path.startsWith("trending")) null else s.kind) } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
                    }
                }.awaitAll()
                val trending = d.sources.any { it.path.startsWith("trending") }
                val items = if (trending) answers.flatten()
                else interleave(answers.filterIndexed { i, _ -> d.sources[i].kind == Kind.Movie }.flatten(), answers.filterIndexed { i, _ -> d.sources[i].kind == Kind.Tv }.flatten())
                Row(d.id, d.title, items, d.top)
            }
        }.awaitAll()
    }

    /** La scheda TMDB di un titolo del catalogo (continua a guardare, schede di dettaglio). */
    suspend fun lookup(key: String, kind: Kind, name: String, year: String?): Card? {
        val query = matchKey(name)
        if (query.isEmpty() || key.isEmpty()) return null
        return try {
            val list = cards(get(key, "search/${if (kind == Kind.Movie) "movie" else "tv"}", mapOf("query" to query)), kind).filter { query in it.keys }
            list.firstOrNull { year != null && it.year == year.take(4) } ?: list.firstOrNull()
        } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
    }
}
