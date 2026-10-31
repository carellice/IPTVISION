package com.carellice.iptvision.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Impostazioni nelle SharedPreferences private dell'app (nessun'altra app può leggerle). */
class Settings(context: Context, private val defaultAutoPlay: Boolean) {
    private val p = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var server: String?
        get() = p.getString("server", null)
        set(v) = p.edit().putString("server", v).apply()
    var username: String?
        get() = p.getString("username", null)
        set(v) = p.edit().putString("username", v).apply()
    var password: String?
        get() = p.getString("password", null)
        set(v) = p.edit().putString("password", v).apply()

    val account: XtreamAccount?
        get() {
            val s = server ?: return null
            val u = username ?: return null
            val pw = password ?: return null
            if (s.isBlank() || u.isBlank()) return null
            return XtreamAccount(s, u, pw)
        }

    var favorites: Set<Int>
        get() = p.getStringSet("favorites", emptySet())!!.mapNotNull { it.toIntOrNull() }.toSet()
        set(v) = p.edit().putStringSet("favorites", v.map { it.toString() }.toSet()).apply()

    var lastStreamId: Int?
        get() = p.getInt("lastStreamId", -1).takeIf { it >= 0 }
        set(v) = p.edit().putInt("lastStreamId", v ?: -1).apply()

    var lastCategoryId: String?
        get() = p.getString("lastCategoryId", null)
        set(v) = p.edit().putString("lastCategoryId", v).apply()

    /** "ts" (MPEG-TS) oppure "m3u8" (HLS). */
    var outputFormat: String
        get() = p.getString("outputFormat", "ts")!!
        set(v) = p.edit().putString("outputFormat", v).apply()

    var autoPlayLastChannel: Boolean
        get() = p.getBoolean("autoPlayLast", defaultAutoPlay)
        set(v) = p.edit().putBoolean("autoPlayLast", v).apply()

    var autoCheckUpdates: Boolean
        get() = p.getBoolean("autoCheckUpdates", true)
        set(v) = p.edit().putBoolean("autoCheckUpdates", v).apply()

    /** Nasconde le categorie con "XXX" nel nome (canali, film e serie). */
    var hideAdult: Boolean
        get() = p.getBoolean("hideAdult", false)
        set(v) = p.edit().putBoolean("hideAdult", v).apply()

    /** Ordinamento scelto per una sezione ("Live", "Movies", "Series"). */
    fun sort(section: String): String? = p.getString("sort_$section", null)
    fun setSort(section: String, value: String) = p.edit().putString("sort_$section", value).apply()

    /** Griglia o elenco per una sezione; senza scelta: griglia per film e serie, elenco per i canali. */
    fun isGrid(section: String): Boolean = p.getBoolean("grid_$section", section != "Live")
    fun setGrid(section: String, value: Boolean) = p.edit().putBoolean("grid_$section", value).apply()

    fun clearAccount() {
        p.edit().remove("server").remove("username").remove("password").remove("lastStreamId").remove("lastCategoryId").apply()
    }
}

/**
 * Ricorda dove si è arrivati in film ed episodi, quali sono stati visti
 * e l'ultimo episodio aperto di ogni serie. Chiavi: "m:{id}" film, "e:{id}" episodi.
 */
class PositionStore(private val file: File) {
    data class Entry(val positionMs: Long, val durationMs: Long, val updatedAt: Long)

    private val positions = HashMap<String, Entry>()
    private val watched = HashSet<String>()
    private val lastEpisode = HashMap<Int, Pair<String, Long>>()
    private var dirty = false
    private var lastSave = 0L

    init {
        try {
            if (file.exists()) {
                val o = JSONObject(file.readText())
                o.optJSONObject("positions")?.let { ps ->
                    ps.keys().forEach { k ->
                        val e = ps.getJSONObject(k)
                        positions[k] = Entry(e.getLong("p"), e.getLong("d"), e.getLong("u"))
                    }
                }
                o.optJSONArray("watched")?.let { for (i in 0 until it.length()) watched += it.getString(i) }
                o.optJSONObject("lastEpisode")?.let { le ->
                    le.keys().forEach { k ->
                        val e = le.getJSONObject(k)
                        k.toIntOrNull()?.let { id -> lastEpisode[id] = e.getString("id") to e.getLong("u") }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w("Posizioni di ripresa illeggibili", e)
        }
    }

    /** Da dove riprendere (0 = dall'inizio). Non riprende i primi 30 s né gli ultimi 90 s. */
    @Synchronized
    fun resumeMs(key: String): Long {
        val e = positions[key] ?: return 0
        return if (e.positionMs > 30_000 && (e.durationMs <= 0 || e.durationMs - e.positionMs > 90_000)) e.positionMs else 0
    }

    @Synchronized
    fun progress(key: String): Float {
        if (key in watched) return 1f
        val e = positions[key] ?: return 0f
        return if (e.durationMs > 0) (e.positionMs.toFloat() / e.durationMs).coerceIn(0f, 0.99f) else 0f
    }

    @Synchronized
    fun isWatched(key: String) = key in watched

    @Synchronized
    fun updatedAt(key: String): Long? = positions[key]?.updatedAt

    /** Aggiorna la posizione. Restituisce true se il contenuto risulta finito. */
    @Synchronized
    fun update(key: String, positionMs: Long, durationMs: Long): Boolean {
        if (durationMs <= 0 || positionMs <= 0) return false
        if (positionMs >= durationMs * 0.95 || durationMs - positionMs < 90_000) {
            markWatched(key)
            return true
        }
        if (positionMs < 30_000) return false
        positions[key] = Entry(positionMs, durationMs, System.currentTimeMillis())
        watched.remove(key)
        dirty = true
        return false
    }

    @Synchronized
    fun markWatched(key: String) {
        positions.remove(key)
        if (watched.add(key)) dirty = true
    }

    @Synchronized
    fun setLastEpisode(seriesId: Int, episodeId: String) {
        lastEpisode[seriesId] = episodeId to System.currentTimeMillis()
        dirty = true
    }

    @Synchronized
    fun lastEpisode(seriesId: Int): Pair<String, Long>? = lastEpisode[seriesId]

    /** Toglie un film da "Continua a guardare": dimentica il punto raggiunto. */
    @Synchronized
    fun forgetPosition(key: String) {
        if (positions.remove(key) != null) dirty = true
    }

    /** Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti. */
    @Synchronized
    fun forgetSeries(seriesId: Int) {
        if (lastEpisode.remove(seriesId) != null) dirty = true
    }

    @Synchronized
    fun save(force: Boolean = false) {
        if (!dirty) return
        if (!force && System.currentTimeMillis() - lastSave < 15_000) return
        try {
            if (positions.size > 600) {
                positions.entries.sortedBy { it.value.updatedAt }.take(positions.size - 600).map { it.key }.forEach(positions::remove)
            }
            val o = JSONObject()
            o.put("positions", JSONObject().apply {
                positions.forEach { (k, e) -> put(k, JSONObject().put("p", e.positionMs).put("d", e.durationMs).put("u", e.updatedAt)) }
            })
            o.put("watched", JSONArray(watched.toList()))
            o.put("lastEpisode", JSONObject().apply {
                lastEpisode.forEach { (k, v) -> put(k.toString(), JSONObject().put("id", v.first).put("u", v.second)) }
            })
            writeAtomic(file, o.toString())
            dirty = false
            lastSave = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.w("Salvataggio posizioni fallito", e)
        }
    }
}

fun writeAtomic(file: File, text: String) {
    val tmp = File(file.path + ".tmp")
    tmp.writeText(text)
    if (!tmp.renameTo(file)) {
        file.delete()
        tmp.renameTo(file)
    }
}
