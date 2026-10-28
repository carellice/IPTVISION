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

data class AuthInfo(val status: String?, val expiresAt: Long?, val maxConnections: Int)

data class VodInfo(
    val plot: String?,
    val genre: String?,
    val year: String?,
    val duration: String?,
    val director: String?,
    val cast: String?,
)

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
}
