package com.carellice.iptvision.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.carellice.iptvision.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

data class UpdateInfo(val version: String, val notes: String, val downloadUrl: String, val fileName: String, val size: Long, val pageUrl: String)

/**
 * Aggiornamenti dalle release di GitHub: la stessa release del setup per Windows
 * contiene l'APK. Si scarica nella cache e si apre l'installer di sistema.
 */
object UpdateService {
    const val REPOSITORY = "carellice/IPTVISION"
    const val REPOSITORY_URL = "https://github.com/$REPOSITORY"
    private const val LATEST_URL = "https://api.github.com/repos/$REPOSITORY/releases/latest"

    val currentVersion: String get() = BuildConfig.VERSION_NAME

    private fun parse(v: String?): List<Int>? {
        if (v.isNullOrBlank()) return null
        var t = v.trim().trimStart('v', 'V')
        val cut = t.indexOfAny(charArrayOf('+', '-', ' '))
        if (cut > 0) t = t.substring(0, cut)
        val parts = t.split('.').map { it.toIntOrNull() ?: return null }
        return (parts + listOf(0, 0, 0)).take(3)
    }

    fun isNewer(latest: String, current: String): Boolean {
        val a = parse(latest) ?: return false
        val b = parse(current) ?: return true
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    /** Ultima release se più recente di quella in uso e con un APK allegato, altrimenti null. */
    suspend fun check(): UpdateInfo? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(LATEST_URL).header("Accept", "application/vnd.github+json").build()
        XtreamClient.http.newBuilder().callTimeout(15, TimeUnit.SECONDS).build().newCall(req).execute().use { resp ->
            if (resp.code == 404) return@withContext null
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val root = JSONObject(resp.body!!.string())
            if (root.optBoolean("draft") || root.optBoolean("prerelease")) return@withContext null
            val tag = root.optString("tag_name")
            if (!isNewer(tag, currentVersion)) return@withContext null
            val assets = root.optJSONArray("assets") ?: return@withContext null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val name = a.optString("name")
                if (!name.endsWith(".apk", true)) continue
                val url = a.optString("browser_download_url").takeIf { it.isNotEmpty() } ?: continue
                return@withContext UpdateInfo(
                    version = tag.trimStart('v', 'V'),
                    notes = root.optString("body").trim(),
                    downloadUrl = url,
                    fileName = name,
                    size = a.optLong("size"),
                    pageUrl = root.optString("html_url", REPOSITORY_URL),
                )
            }
            null
        }
    }

    /** Scarica l'APK nella cache; progress riceve valori da 0 a 1. */
    suspend fun download(context: Context, info: UpdateInfo, progress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates")
        dir.listFiles()?.forEach { it.delete() }
        dir.mkdirs()
        val target = File(dir, "IPTVISION-${info.version}.apk")
        val partial = File(dir, target.name + ".part")
        val call = XtreamClient.http.newBuilder().callTimeout(10, TimeUnit.MINUTES).readTimeout(60, TimeUnit.SECONDS).build()
            .newCall(Request.Builder().url(info.downloadUrl).build())
        call.execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val body = resp.body!!
            val total = body.contentLength().takeIf { it > 0 } ?: info.size
            body.byteStream().use { input ->
                partial.outputStream().use { out ->
                    val buf = ByteArray(1 shl 16)
                    var done = 0L
                    while (true) {
                        ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0) progress((done.toFloat() / total).coerceAtMost(1f))
                    }
                    if (total > 0 && done != total) throw IOException("Download incompleto")
                }
            }
        }
        if (!partial.renameTo(target)) throw IOException("Impossibile salvare l'aggiornamento")
        progress(1f)
        target
    }

    /** Su Android 8+ l'utente deve consentire una volta a IPTVISION di installare app. */
    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { context.startActivity(i) } catch (e: Exception) { Log.w("Impostazione installazione non disponibile", e) }
        }
    }

    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", apk)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
    }
}
