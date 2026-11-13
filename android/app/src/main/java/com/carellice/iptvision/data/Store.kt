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

    /** Stile grafico: "classic" (moderno) o "skeuo" (skeuomorfico, vedi ui/Components.kt). */
    var skin: String
        get() = p.getString("skin", "classic") ?: "classic"
        set(v) = p.edit().putString("skin", v).apply()

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

    // ---------- Server di casa (IPTVISION su CasaOS) ----------

    /** Indirizzo del server di casa; null = l'app parla direttamente col provider IPTV. */
    var homeServer: String?
        get() = p.getString("homeServer", null)
        set(v) = p.edit().putString("homeServer", v).apply()

    /** Ultima revisione di preferiti e posizioni avuta dal server. */
    var homeRevision: Int
        get() = p.getInt("homeRevision", -1)
        set(v) = p.edit().putInt("homeRevision", v).apply()

    /** L'account IPTV del dispositivo prima di collegare il server: torna quando lo si scollega. */
    fun stashOwnAccount() {
        p.edit().putString("own_server", server).putString("own_username", username).putString("own_password", password).apply()
    }

    fun restoreOwnAccount() {
        p.edit().putString("server", p.getString("own_server", null)).putString("username", p.getString("own_username", null))
            .putString("password", p.getString("own_password", null)).remove("own_server").remove("own_username").remove("own_password")
            .remove("lastStreamId").remove("lastCategoryId").remove("homeServer").remove("homeRevision").apply()
    }

    // ---------- Liste IPTV salvate ----------

    /** Account Xtream salvati, ognuno col suo nome; quello in uso è anche in server/username/password. */
    val lists: List<SavedList>
        get() {
            val out = ArrayList<SavedList>()
            try {
                val a = JSONArray(p.getString("lists", "[]"))
                for (i in 0 until a.length()) {
                    val o = a.getJSONObject(i)
                    out += SavedList(o.getString("alias"), o.getString("server"), o.getString("username"), o.getString("password"),
                        if (o.isNull("expiresAt")) null else o.getLong("expiresAt"))
                }
            } catch (e: Exception) {
                Log.w("Liste salvate illeggibili", e)
            }
            // Account di prima delle liste: quello in uso diventa la prima lista.
            val a = account
            if (out.isEmpty() && a != null && homeServer == null) out += SavedList(a.username, a.server, a.username, a.password, null)
            return out
        }

    private fun writeLists(lists: List<SavedList>) {
        val a = JSONArray()
        lists.forEach {
            a.put(JSONObject().put("alias", it.alias).put("server", it.server).put("username", it.username)
                .put("password", it.password).put("expiresAt", it.expiresAt ?: JSONObject.NULL))
        }
        p.edit().putString("lists", a.toString()).apply()
    }

    /** Aggiunge la lista o aggiorna quella con stesso server e utente (il nome resta se non se ne dà uno nuovo). */
    fun saveList(l: SavedList) {
        val all = lists.toMutableList()
        val i = all.indexOfFirst { it.isSame(l.server, l.username) }
        if (i >= 0) all[i] = l.copy(alias = l.alias.ifBlank { all[i].alias }) else all += l.copy(alias = l.alias.ifBlank { l.username })
        writeLists(all)
    }

    fun removeList(l: SavedList) = writeLists(lists.filterNot { it.isSame(l.server, l.username) })

    /** La lista in uso, se l'app parla direttamente col provider. */
    val activeList: SavedList?
        get() = if (homeServer != null) null else lists.firstOrNull { it.isSame(server, username) }

    fun clearAccount() {
        p.edit().remove("server").remove("username").remove("password").remove("lastStreamId").remove("lastCategoryId").apply()
    }
}

/**
 * Ricorda dove si è arrivati in film ed episodi, quali sono stati visti, l'ultimo episodio
 * aperto di ogni serie e la "Mia lista". Chiavi: "m:{id}" film, "e:{id}" episodi, "s:{id}" serie.
 */
class PositionStore(private val file: File) {
    data class Entry(val positionMs: Long, val durationMs: Long, val updatedAt: Long)

    /** Ogni modifica, nel formato delle operazioni del server di casa (POST /api/ops). */
    var onChange: ((JSONObject) -> Unit)? = null

    private val positions = HashMap<String, Entry>()
    private val watched = HashSet<String>()
    private val lastEpisode = HashMap<Int, Pair<String, Long>>()
    /** La "Mia lista": film ("m:") e serie ("s:") con il momento in cui sono stati aggiunti. */
    private val myList = HashMap<String, Long>()
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
                readMyList(o)
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
        onChange?.invoke(JSONObject().put("op", "position").put("key", key).put("p", positionMs).put("d", durationMs))
        return false
    }

    @Synchronized
    fun markWatched(key: String) {
        positions.remove(key)
        if (watched.add(key)) dirty = true
        onChange?.invoke(JSONObject().put("op", "watched").put("key", key))
    }

    @Synchronized
    fun setLastEpisode(seriesId: Int, episodeId: String) {
        lastEpisode[seriesId] = episodeId to System.currentTimeMillis()
        dirty = true
        onChange?.invoke(JSONObject().put("op", "lastEpisode").put("seriesId", seriesId).put("id", episodeId))
    }

    @Synchronized
    fun lastEpisode(seriesId: Int): Pair<String, Long>? = lastEpisode[seriesId]

    /** Toglie un film da "Continua a guardare": dimentica il punto raggiunto. */
    @Synchronized
    fun forgetPosition(key: String) {
        if (positions.remove(key) != null) dirty = true
        onChange?.invoke(JSONObject().put("op", "forgetPosition").put("key", key))
    }

    /** Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti. */
    @Synchronized
    fun forgetSeries(seriesId: Int) {
        if (lastEpisode.remove(seriesId) != null) dirty = true
        onChange?.invoke(JSONObject().put("op", "forgetSeries").put("seriesId", seriesId))
    }

    @Synchronized
    fun inMyList(key: String) = key in myList

    /** Le chiavi della "Mia lista", dall'ultima aggiunta. */
    @Synchronized
    fun myList(): List<String> = myList.entries.sortedByDescending { it.value }.map { it.key }

    @Synchronized
    fun setMyList(key: String, on: Boolean) {
        val changed = if (on) myList.put(key, System.currentTimeMillis()) == null else myList.remove(key) != null
        if (!changed) return
        dirty = true
        onChange?.invoke(JSONObject().put("op", "myList").put("key", key).put("on", on))
    }

    private fun readMyList(o: JSONObject) {
        o.optJSONObject("myList")?.let { ml -> ml.keys().forEach { k -> myList[k] = ml.getLong(k) } }
    }

    private fun myListJson() = JSONObject().apply { myList.forEach { (k, u) -> put(k, u) } }

    /** Tutto il contenuto, nel formato di positions.json (e di GET /api/state del server di casa). */
    @Synchronized
    fun toJson(): JSONObject = JSONObject().apply {
        put("positions", JSONObject().apply {
            positions.forEach { (k, e) -> put(k, JSONObject().put("p", e.positionMs).put("d", e.durationMs).put("u", e.updatedAt)) }
        })
        put("watched", JSONArray(watched.toList()))
        put("lastEpisode", JSONObject().apply {
            lastEpisode.forEach { (k, v) -> put(k.toString(), JSONObject().put("id", v.first).put("u", v.second)) }
        })
        put("myList", myListJson())
    }

    /** Sostituisce tutto con i dati del server di casa (stesso formato di positions.json). */
    @Synchronized
    fun replaceWith(o: JSONObject) {
        positions.clear(); watched.clear(); lastEpisode.clear(); myList.clear()
        o.optJSONObject("positions")?.let { ps ->
            ps.keys().forEach { k -> val e = ps.getJSONObject(k); positions[k] = Entry(e.getLong("p"), e.getLong("d"), e.getLong("u")) }
        }
        o.optJSONArray("watched")?.let { for (i in 0 until it.length()) watched += it.getString(i) }
        o.optJSONObject("lastEpisode")?.let { le ->
            le.keys().forEach { k -> val e = le.getJSONObject(k); k.toIntOrNull()?.let { id -> lastEpisode[id] = e.getString("id") to e.getLong("u") } }
        }
        readMyList(o)
        dirty = true
        save(force = true)
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
            o.put("myList", myListJson())
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
