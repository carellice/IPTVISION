package com.carellice.iptvision.data

import android.util.Xml
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * Guida TV. Fonte principale: xmltv.php (una sola richiesta per tutti i canali),
 * filtrata ai soli canali dell'account e salvata su disco per 6 ore.
 * Ripiego per il canale in onda: get_short_epg.
 */
class EpgService(private val cacheDir: File) {
    @Volatile
    private var byEpgId: Map<String, List<Programme>> = emptyMap()
    private val short = ConcurrentHashMap<Int, Pair<Long, List<Programme>>>()

    val hasData get() = byEpgId.isNotEmpty()

    suspend fun load(client: XtreamClient, wantedIds: Collection<String>, force: Boolean) = withContext(Dispatchers.IO) {
        val file = File(cacheDir, "epg_${client.account.key}.json")
        if (!force && file.exists()) {
            try {
                val o = JSONObject(file.readText())
                byEpgId = fromJson(o.getJSONObject("data"))
                if (System.currentTimeMillis() - o.getLong("savedAt") < 6 * 3600_000L) return@withContext
            } catch (e: Exception) {
                Log.w("Cache EPG illeggibile", e)
            }
        }
        val wanted = wantedIds.map { it.lowercase() }.toHashSet()
        if (wanted.isEmpty()) return@withContext
        try {
            val data = downloadAndParse(client.xmltvUrl, wanted)
            if (data.isEmpty()) return@withContext
            byEpgId = data
            writeAtomic(file, JSONObject().put("savedAt", System.currentTimeMillis()).put("data", toJson(data)).toString())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("Download EPG fallito", e)
        }
    }

    private suspend fun downloadAndParse(url: String, wanted: Set<String>): Map<String, List<Programme>> {
        val nowSec = System.currentTimeMillis() / 1000
        val from = nowSec - 3 * 3600
        val to = nowSec + 36 * 3600
        val result = HashMap<String, MutableList<Programme>>()
        val ctx = coroutineContext
        val call = XtreamClient.http.newBuilder().callTimeout(3, TimeUnit.MINUTES).build().newCall(Request.Builder().url(url).build())
        call.execute().use { resp ->
            if (!resp.isSuccessful) throw java.io.IOException("HTTP ${resp.code}")
            val parser = Xml.newPullParser()
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            parser.setInput(resp.body!!.byteStream(), null)
            var event = parser.eventType
            var count = 0
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG && parser.name == "programme") {
                    if (++count % 2000 == 0) ctx.ensureActive()
                    val channel = parser.getAttributeValue(null, "channel")?.lowercase()
                    val start = parseXmltvTime(parser.getAttributeValue(null, "start"))
                    val stop = parseXmltvTime(parser.getAttributeValue(null, "stop"))
                    val keep = channel != null && channel in wanted && start != null && stop != null && stop >= from && start <= to
                    var title: String? = null
                    var desc: String? = null
                    val depth = parser.depth
                    while (true) {
                        event = parser.next()
                        if (event == XmlPullParser.END_DOCUMENT) break
                        if (event == XmlPullParser.END_TAG && parser.depth == depth) break
                        if (keep && event == XmlPullParser.START_TAG && parser.depth == depth + 1) {
                            if (parser.name == "title" && title == null) title = readText(parser)
                            else if (parser.name == "desc" && desc == null) desc = readText(parser)
                        }
                    }
                    if (keep) result.getOrPut(channel!!) { ArrayList() } += Programme(start!!, stop!!, title ?: "", desc)
                }
                event = parser.next()
            }
        }
        result.values.forEach { it.sortBy { p -> p.start } }
        return result
    }

    private fun readText(p: XmlPullParser): String {
        val sb = StringBuilder()
        val depth = p.depth
        while (true) {
            val e = p.next()
            if (e == XmlPullParser.TEXT) sb.append(p.text)
            if (e == XmlPullParser.END_DOCUMENT || (e == XmlPullParser.END_TAG && p.depth == depth)) break
        }
        return sb.toString().trim()
    }

    fun nowNext(ch: Channel, nowSec: Long = System.currentTimeMillis() / 1000): Pair<Programme?, Programme?> {
        val list = listFor(ch) ?: return null to null
        for (i in list.indices) {
            val p = list[i]
            if (p.start <= nowSec && p.stop > nowSec) return p to list.getOrNull(i + 1)
            if (p.start > nowSec) return null to p
        }
        return null to null
    }

    fun upcoming(ch: Channel, count: Int): List<Programme> {
        val now = System.currentTimeMillis() / 1000
        return listFor(ch)?.filter { it.stop > now }?.take(count) ?: emptyList()
    }

    private fun listFor(ch: Channel): List<Programme>? {
        ch.epgId?.let { id -> byEpgId[id.lowercase()]?.takeIf { it.isNotEmpty() }?.let { return it } }
        return short[ch.streamId]?.second
    }

    /** Se xmltv non copre il canale, chiede l'EPG breve (al massimo ogni 20 minuti). */
    suspend fun ensureShort(client: XtreamClient, ch: Channel): Boolean {
        val now = System.currentTimeMillis()
        if (nowNext(ch).first != null) return false
        short[ch.streamId]?.let { if (now - it.first < 20 * 60_000L) return false }
        return try {
            val list = client.shortEpg(ch.streamId)
            short[ch.streamId] = now to list
            list.isNotEmpty()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            short[ch.streamId] = now to emptyList()
            Log.w("EPG breve non disponibile", e)
            false
        }
    }

    companion object {
        /** Formato XMLTV: "20261028203000 +0100". Restituisce secondi Unix. */
        fun parseXmltvTime(s: String?): Long? {
            if (s == null || s.length < 14) return null
            val y = s.substring(0, 4).toIntOrNull() ?: return null
            val mo = s.substring(4, 6).toIntOrNull() ?: return null
            val d = s.substring(6, 8).toIntOrNull() ?: return null
            val h = s.substring(8, 10).toIntOrNull() ?: return null
            val mi = s.substring(10, 12).toIntOrNull() ?: return null
            val se = s.substring(12, 14).toIntOrNull() ?: return null
            var offsetMin = 0
            val rest = s.substring(14).trim()
            if (rest.length >= 5 && (rest[0] == '+' || rest[0] == '-')) {
                val hh = rest.substring(1, 3).toIntOrNull()
                val mm = rest.substring(3, 5).toIntOrNull()
                if (hh != null && mm != null) offsetMin = (hh * 60 + mm) * if (rest[0] == '-') -1 else 1
            }
            val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            c.clear()
            c.set(y, mo - 1, d, h, mi, se)
            return c.timeInMillis / 1000 - offsetMin * 60L
        }

        private fun toJson(data: Map<String, List<Programme>>) = JSONObject().apply {
            data.forEach { (k, list) ->
                put(k, JSONArray().apply {
                    list.forEach { p -> put(JSONArray().put(p.start).put(p.stop).put(p.title).put(p.description ?: JSONObject.NULL)) }
                })
            }
        }

        private fun fromJson(o: JSONObject): Map<String, List<Programme>> {
            val map = HashMap<String, List<Programme>>()
            o.keys().forEach { k ->
                val arr = o.getJSONArray(k)
                map[k] = List(arr.length()) { i ->
                    val a = arr.getJSONArray(i)
                    Programme(a.getLong(0), a.getLong(1), a.getString(2), if (a.isNull(3)) null else a.getString(3))
                }
            }
            return map
        }
    }
}
