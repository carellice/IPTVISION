package com.carellice.iptvision.data

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Film ed episodi scaricati per guardarli senza connessione (solo telefoni e tablet).
 * Scarica il DownloadManager di Android: continua anche ad app chiusa e mostra l'avanzamento nelle notifiche.
 * Si scarica un file alla volta, perché molti servizi IPTV accettano una sola connessione per account;
 * gli altri aspettano in coda. I file stanno nella cartella privata dell'app (Android/data/…/Movies)
 * e si cancellano disinstallando l'app.
 */
class Downloads private constructor(context: Context) {
    enum class State { Queued, Running, Done, Failed }

    data class Item(
        /** Stessa chiave delle posizioni: "m:{id}" film, "e:{id}" episodi. */
        val key: String,
        val title: String,
        val image: String?,
        val url: String,
        val fileName: String,
        val movieId: Int? = null,
        val episodeId: String? = null,
        val seriesId: Int? = null,
        val seriesName: String? = null,
        val seriesCover: String? = null,
        val season: Int = 0,
        val number: Int = 0,
        val episodeTitle: String? = null,
        val extension: String = "mp4",
        val state: State = State.Queued,
        val downloadId: Long = -1,
        val bytes: Long = 0,
        val total: Long = 0,
        val error: String? = null,
    ) {
        val isEpisode get() = episodeId != null
        val progress get() = if (total > 0) (bytes.toFloat() / total).coerceIn(0f, 1f) else 0f
    }

    private val app = context.applicationContext
    private val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val store = File(app.filesDir, "downloads.json")
    private val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Cambia a ogni modifica: l'interfaccia si ridisegna. */
    var items by mutableStateOf(load()); private set

    var wifiOnly: Boolean
        get() = prefs.getBoolean("downloadWifiOnly", true)
        set(v) { prefs.edit().putBoolean("downloadWifiOnly", v).apply() }

    val dir: File? get() = app.getExternalFilesDir(Environment.DIRECTORY_MOVIES)

    fun get(key: String): Item? = items.firstOrNull { it.key == key }

    /** Il file scaricato, se è completo e c'è ancora. */
    fun localFile(key: String): File? {
        val it = get(key)?.takeIf { it.state == State.Done } ?: return null
        return File(dir ?: return null, it.fileName).takeIf { f -> f.exists() }
    }

    fun add(item: Item) {
        if (get(item.key) != null) return
        update(items + item)
        pump()
    }

    fun retry(key: String) {
        update(items.map { if (it.key == key) it.copy(state = State.Queued, downloadId = -1, bytes = 0, error = null) else it })
        pump()
    }

    fun remove(key: String) {
        val it = get(key) ?: return
        if (it.downloadId >= 0) dm.remove(it.downloadId) // ferma il download e cancella il file parziale
        dir?.let { d -> File(d, it.fileName).delete() }
        update(items.filter { x -> x.key != key })
        pump()
    }

    fun usedBytes(): Long = items.filter { it.state == State.Done }.sumOf { it.total }
    fun freeBytes(): Long = dir?.let { runCatching { StatFs(it.path).availableBytes }.getOrNull() } ?: 0

    /** Avvia il prossimo in coda se non ce n'è già uno in corso. */
    fun pump() {
        if (items.any { it.state == State.Running }) return
        val next = items.firstOrNull { it.state == State.Queued } ?: return
        val req = DownloadManager.Request(Uri.parse(next.url))
            .addRequestHeader("User-Agent", XtreamClient.USER_AGENT)
            .setTitle(next.title)
            .setDescription("IPTVISION")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(!wifiOnly)
            .setAllowedOverRoaming(false)
            .setDestinationInExternalFilesDir(app, Environment.DIRECTORY_MOVIES, next.fileName)
        val id = try { dm.enqueue(req) } catch (e: Exception) {
            Log.w("Download non avviato", e)
            set(next.key) { it.copy(state = State.Failed, error = "Download non avviato") }
            return
        }
        set(next.key) { it.copy(state = State.Running, downloadId = id, error = null) }
    }

    /** Legge l'avanzamento dal DownloadManager; si chiama ogni secondo mentre l'app è aperta e alla fine di ogni download. */
    fun refresh() {
        val running = items.firstOrNull { it.state == State.Running } ?: run { pump(); return }
        val c = dm.query(DownloadManager.Query().setFilterById(running.downloadId))
        c.use {
            if (!it.moveToFirst()) {
                // Annullato dalle notifiche o dalle impostazioni di Android.
                set(running.key) { x -> x.copy(state = State.Failed, downloadId = -1, error = "Download annullato") }
                pump()
                return
            }
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val bytes = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).coerceAtLeast(0)
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    set(running.key) { x -> x.copy(state = State.Done, bytes = bytes, total = maxOf(total, bytes), downloadId = -1) }
                    pump()
                }
                DownloadManager.STATUS_FAILED -> {
                    val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    dm.remove(running.downloadId)
                    set(running.key) { x -> x.copy(state = State.Failed, downloadId = -1, bytes = 0, error = reasonText(reason)) }
                    pump()
                }
                else -> if (bytes != running.bytes || total != running.total) {
                    // Solo in memoria: il file si riscrive quando cambia lo stato.
                    items = items.map { x -> if (x.key == running.key) x.copy(bytes = bytes, total = total) else x }
                }
            }
        }
    }

    private fun reasonText(reason: Int) = when (reason) {
        DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Spazio esaurito"
        DownloadManager.ERROR_DEVICE_NOT_FOUND -> "Memoria non disponibile"
        DownloadManager.ERROR_TOO_MANY_REDIRECTS, DownloadManager.ERROR_HTTP_DATA_ERROR, DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "Il server ha interrotto il download"
        in 400..599 -> "Il server ha risposto con errore $reason"
        else -> "Download non riuscito"
    }

    private fun set(key: String, change: (Item) -> Item) = update(items.map { if (it.key == key) change(it) else it })

    private fun update(list: List<Item>) {
        items = list
        save(list)
    }

    private fun save(list: List<Item>) {
        val arr = JSONArray()
        list.forEach { i ->
            arr.put(JSONObject().apply {
                put("key", i.key); put("title", i.title); put("image", i.image); put("url", i.url); put("fileName", i.fileName)
                put("movieId", i.movieId); put("episodeId", i.episodeId); put("seriesId", i.seriesId)
                put("seriesName", i.seriesName); put("seriesCover", i.seriesCover); put("season", i.season); put("number", i.number)
                put("episodeTitle", i.episodeTitle); put("extension", i.extension); put("state", i.state.name)
                put("downloadId", i.downloadId); put("bytes", i.bytes); put("total", i.total); put("error", i.error)
            })
        }
        try {
            val tmp = File(store.path + ".tmp")
            tmp.writeText(arr.toString())
            tmp.renameTo(store)
        } catch (e: Exception) { Log.w("Salvataggio download fallito", e) }
    }

    private fun load(): List<Item> = try {
        if (!store.exists()) emptyList() else {
            val arr = JSONArray(store.readText())
            (0 until arr.length()).map { n ->
                val o = arr.getJSONObject(n)
                fun s(k: String) = if (o.isNull(k)) null else o.optString(k)
                Item(
                    key = o.getString("key"), title = o.getString("title"), image = s("image"), url = o.getString("url"), fileName = o.getString("fileName"),
                    movieId = if (o.isNull("movieId")) null else o.optInt("movieId"), episodeId = s("episodeId"),
                    seriesId = if (o.isNull("seriesId")) null else o.optInt("seriesId"), seriesName = s("seriesName"), seriesCover = s("seriesCover"),
                    season = o.optInt("season"), number = o.optInt("number"), episodeTitle = s("episodeTitle"), extension = o.optString("extension", "mp4"),
                    state = runCatching { State.valueOf(o.getString("state")) }.getOrDefault(State.Queued),
                    downloadId = o.optLong("downloadId", -1), bytes = o.optLong("bytes"), total = o.optLong("total"), error = s("error"),
                )
            }
        }
    } catch (e: Exception) {
        Log.w("Elenco download illeggibile", e); emptyList()
    }

    companion object {
        @Volatile private var instance: Downloads? = null
        fun get(context: Context): Downloads = instance ?: synchronized(this) { instance ?: Downloads(context).also { instance = it } }

        /** Nome del file: titolo leggibile più la chiave, così due versioni dello stesso film non si sovrascrivono. */
        fun fileNameFor(title: String, key: String, ext: String): String {
            val safe = title.replace(Regex("[^A-Za-z0-9 ._()\\-]"), "").trim().take(80).ifEmpty { "video" }
            return "$safe [${key.replace(':', '-')}].$ext"
        }
    }
}

/** Fine di un download anche ad app chiusa: si aggiorna l'elenco e parte il prossimo in coda. */
class DownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == DownloadManager.ACTION_DOWNLOAD_COMPLETE) Downloads.get(context).refresh()
    }
}
