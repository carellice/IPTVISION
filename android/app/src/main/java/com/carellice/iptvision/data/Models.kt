package com.carellice.iptvision.data

import java.text.Normalizer
import java.util.Locale

data class Category(val id: String, val name: String)

data class Channel(
    val streamId: Int,
    val num: Int,
    val name: String,
    val logo: String?,
    val categoryId: String?,
    val epgId: String?,
) {
    val searchKey = TextHelpers.normalize(name)
    val initials = TextHelpers.initials(name)
}

data class Movie(
    val streamId: Int,
    val name: String,
    val poster: String?,
    val categoryId: String?,
    val extension: String?,
    val year: String?,
    val rating: Double,
    val added: Long,
) {
    val searchKey = TextHelpers.normalize(name)
    val initials = TextHelpers.initials(name)
    val key get() = "m:$streamId"
    val ext get() = extension?.takeIf { it.isNotBlank() } ?: "mp4"
    val meta = TextHelpers.joinMeta(year, if (rating > 0) "★ " + String.format(Locale.ROOT, "%.1f", rating) else null)
}

data class Series(
    val seriesId: Int,
    val name: String,
    val cover: String?,
    val categoryId: String?,
    val year: String?,
    val rating: Double,
    val plot: String?,
    val genre: String?,
) {
    val searchKey = TextHelpers.normalize(name)
    val initials = TextHelpers.initials(name)
    val key get() = "s:$seriesId"
    val meta = TextHelpers.joinMeta(year, genre, if (rating > 0) "★ " + String.format(Locale.ROOT, "%.1f", rating) else null)
}

data class Episode(
    val id: String,
    val seriesId: Int,
    val season: Int,
    val number: Int,
    val title: String,
    val extension: String,
    val durationSecs: Int,
    val plot: String?,
    val image: String?,
) {
    val key get() = "e:$id"
    val label get() = "S$season E$number"
    val displayTitle get() = title.ifBlank { "Episodio $number" }
    val durationText get() = if (durationSecs > 0) "${maxOf(1, Math.round(durationSecs / 60.0).toInt())} min" else ""
}

/** Orari in secondi Unix. */
data class Programme(val start: Long, val stop: Long, val title: String, val description: String?) {
    fun progressAt(nowSec: Long): Float {
        val total = stop - start
        if (total <= 0) return 0f
        return ((nowSec - start).toFloat() / total).coerceIn(0f, 1f)
    }

    val timeRange: String get() = "${TextHelpers.clock(start)} – ${TextHelpers.clock(stop)}"
}

/** Un account Xtream salvato con il nome scelto dall'utente; expiresAt in secondi Unix, null = nessuna scadenza. */
/** Con il server di casa: [index] e [active] vengono dal server, la password resta lì. */
data class SavedList(val alias: String, val server: String, val username: String, val password: String, val expiresAt: Long?, val index: Int = -1, val active: Boolean = false) {
    fun isSame(server: String?, username: String?) = this.server.equals(server, ignoreCase = true) && this.username == username
}

data class AuthInfo(val status: String?, val expiresAt: Long?, val maxConnections: Int)

data class VodInfo(
    val plot: String?,
    val genre: String?,
    val year: String?,
    val duration: String?,
    val director: String?,
    val cast: String?,
    val tech: VodTech? = null,
)

/** Dati tecnici del file di un film (get_vod_info): servono a capire cosa cambia tra le versioni dello stesso titolo. */
data class VodTech(
    val width: Int,
    val height: Int,
    val videoCodec: String?,
    val audioCodec: String?,
    val audioChannels: Int,
    val audioLanguage: String?,
    val bitrateKbps: Int,
    val container: String?,
) {
    val resolution: String?
        get() = when {
            height >= 2000 || width >= 3800 -> "4K"
            height >= 1400 || width >= 2500 -> "1440p"
            height >= 1000 || width >= 1900 -> "1080p"
            height >= 700 || width >= 1260 -> "720p"
            height > 0 -> "${height}p"
            else -> null
        }

    /** "HEVC", "Dolby Digital 5.1 · ENG", "18,5 Mbit/s", "MKV": ciò che non è già nella risoluzione. */
    val details: List<String>
        get() = listOfNotNull(
            videoCodec?.let { videoName(it) },
            listOfNotNull(audioCodec?.let { audioName(it) }, channelsName(audioChannels), audioLanguage?.uppercase()?.takeIf { it != "UND" })
                .joinToString(" ").ifEmpty { null },
            if (bitrateKbps > 0) String.format(java.util.Locale.ITALY, "%.1f Mbit/s", bitrateKbps / 1000.0) else null,
            container?.uppercase(),
        )

    private fun videoName(c: String) = when (c.lowercase()) {
        "h264", "avc", "avc1" -> "H.264"
        "hevc", "h265" -> "HEVC"
        "av1" -> "AV1"
        "vp9" -> "VP9"
        "mpeg2video" -> "MPEG-2"
        "mpeg4" -> "MPEG-4"
        else -> c.uppercase()
    }

    private fun audioName(c: String) = when (c.lowercase()) {
        "aac" -> "AAC"
        "ac3" -> "Dolby Digital"
        "eac3" -> "Dolby Digital Plus"
        "truehd" -> "Dolby TrueHD"
        "dts" -> "DTS"
        "mp3" -> "MP3"
        "opus" -> "Opus"
        "flac" -> "FLAC"
        else -> c.uppercase()
    }

    private fun channelsName(n: Int) = when (n) {
        0 -> null
        1 -> "mono"
        2 -> "stereo"
        6 -> "5.1"
        8 -> "7.1"
        else -> "$n canali"
    }
}

data class SeriesInfo(
    val plot: String?,
    val genre: String?,
    val year: String?,
    val cast: String?,
    val episodes: List<Episode>,
)

object TextHelpers {
    private val marks = Regex("\\p{Mn}+")

    /** Minuscolo, senza accenti né punteggiatura: la ricerca non distingue "Città" da "citta". */
    fun normalize(s: String): String {
        val d = marks.replace(Normalizer.normalize(s, Normalizer.Form.NFD), "")
        val sb = StringBuilder(d.length)
        for (c in d) {
            if (c.isLetterOrDigit()) sb.append(c.lowercaseChar())
            else if (sb.isNotEmpty() && sb.last() != ' ') sb.append(' ')
        }
        return sb.toString().trim()
    }

    fun initials(name: String): String {
        val parts = name.split(' ', '-', '_', '|', ':').filter { p -> p.any { it.isLetterOrDigit() } }
        if (parts.isEmpty()) return "TV"
        if (parts.size == 1) return parts[0].filter { it.isLetterOrDigit() }.take(2).uppercase()
        return parts.take(2).joinToString("") { p -> p.first { it.isLetterOrDigit() }.uppercaseChar().toString() }
    }

    fun formatTime(ms: Long): String {
        val t = maxOf(0L, ms) / 1000
        val h = t / 3600
        val m = (t % 3600) / 60
        val s = t % 60
        return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
    }

    fun clock(unixSec: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = unixSec * 1000 }
        return String.format(Locale.ROOT, "%02d:%02d", c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE))
    }

    fun joinMeta(vararg parts: String?): String = parts.filter { !it.isNullOrBlank() }.joinToString("  ·  ")

    // Sigle di qualità, codifica e lingua che i pannelli aggiungono al titolo ("Film (2020) FHD", "Film 4K HDR").
    private val qualityTags = setOf(
        "4k", "uhd", "2160p", "fhd", "1080p", "1080i", "hd", "720p", "sd", "576p", "480p",
        "hdr", "hdr10", "dv", "hevc", "h265", "x265", "h264", "x264", "10bit",
        "3d", "ita", "eng", "subita", "multisub", "bluray", "bdrip", "webdl", "webrip", "dvdrip",
    )
    private val langPrefix = Regex("""^\s*[\[(|]?\s*[A-Z]{2,3}\s*[\])|:\-]\s*""")

    /**
     * Chiave per riconoscere lo stesso titolo pubblicato più volte: nome senza sigle di qualità,
     * senza prefisso di lingua ("IT | ") e senza accenti o punteggiatura.
     */
    fun variantKey(name: String): String {
        val words = normalize(langPrefix.replace(name, "")).split(' ').filter { it.isNotEmpty() && it !in qualityTags }
        return if (words.isEmpty()) normalize(name) else words.joinToString(" ")
    }

    /** Le sigle di qualità presenti nel titolo, per distinguere le versioni ("4K HDR", "FHD"). */
    fun qualityOf(name: String): String? =
        normalize(name).split(' ').filter { it in qualityTags }.distinct().joinToString(" ") { it.uppercase() }.ifEmpty { null }
}

/** Un titolo nelle liste: se è pubblicato più volte (per esempio in FHD e in 4K) raccoglie tutte le versioni. */
data class Entry<T>(val item: T, val variants: List<T>) {
    val hasVariants get() = variants.size > 1
    val variantsText get() = "${variants.size} versioni"
}

/** Raggruppa le copie dello stesso titolo; resta il primo nell'ordine della lista. */
fun <T> groupVariants(items: List<T>, name: (T) -> String): List<Entry<T>> {
    val groups = LinkedHashMap<String, MutableList<T>>()
    for (it in items) groups.getOrPut(TextHelpers.variantKey(name(it))) { ArrayList(1) } += it
    return groups.values.map { Entry(it[0], it) }
}
