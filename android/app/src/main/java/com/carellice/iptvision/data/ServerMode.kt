package com.carellice.iptvision.data

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * "Server di casa": IPTVISION installato su CasaOS (la versione web) fa da server Xtream per l'app.
 * Collegata al server, l'app usa come server Xtream l'indirizzo di casa, come utente l'account
 * del server e come password il gettone di questo dispositivo: liste, guida, flussi e download
 * passano da casa e l'account IPTV vero resta solo sul server.
 * Preferiti, posizioni e "Continua a guardare" sono quelli dell'account, uguali su ogni dispositivo.
 */
class ServerException(message: String) : Exception(message)

data class ServerLogin(val username: String, val token: String, val hasXtream: Boolean)

object ServerApi {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val http by lazy { XtreamClient.http.newBuilder().callTimeout(30, TimeUnit.SECONDS).followRedirects(false).build() }

    /** Porta di IPTVISION su CasaOS quando nell'indirizzo non c'è. */
    const val DEFAULT_PORT = 8765

    /** "192.168.1.10" → "http://192.168.1.10:8765"; con https o con la porta resta com'è, senza "/" finale. */
    fun normalizeUrl(input: String): String {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty()) return s
        val hasScheme = s.startsWith("http://", true) || s.startsWith("https://", true)
        if (!hasScheme) {
            val hostPart = s.substringBefore('/')
            s = "http://$s"
            if (!hostPart.contains(':')) s = s.replaceFirst(hostPart, "$hostPart:$DEFAULT_PORT")
        }
        return s
    }

    val deviceName: String
        get() = "IPTVISION Android · ${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".take(80)

    suspend fun login(url: String, username: String, password: String, register: Boolean, invite: String): ServerLogin {
        val body = JSONObject().put("username", username).put("password", password).put("device", deviceName)
            .put("register", register).put("invite", invite)
        val o = call(url, "POST", "/api/device/login", null, body)
        return ServerLogin(o.getString("username"), o.getString("token"), o.optBoolean("hasXtream"))
    }

    /** Porta sul server l'account IPTV che c'era su questo dispositivo (se il server non ne ha uno). */
    suspend fun sendXtream(url: String, token: String, account: XtreamAccount, alias: String = "") {
        call(url, "POST", "/api/xtream", token, JSONObject().put("server", account.server).put("username", account.username).put("password", account.password).put("alias", alias))
    }

    /** Le liste IPTV del server, senza password. */
    suspend fun lists(url: String, token: String): List<SavedList> {
        val a = call(url, "GET", "/api/xtream/lists", token, null).getJSONArray("list")
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            SavedList(o.getString("alias"), o.getString("server"), o.getString("username"), "",
                if (o.isNull("expiresAt")) null else o.getLong("expiresAt"), o.getInt("index"), o.optBoolean("active"))
        }
    }

    /** Il server passa alla lista [index]; torna lo stato (preferiti e posizioni). */
    suspend fun useList(url: String, token: String, index: Int): JSONObject = call(url, "POST", "/api/xtream/lists/$index/use", token, JSONObject())

    suspend fun removeList(url: String, token: String, index: Int) { call(url, "DELETE", "/api/xtream/lists/$index", token, null) }

    suspend fun importNative(url: String, token: String, data: JSONObject): JSONObject = call(url, "POST", "/api/import-native", token, data)

    /** Preferiti e posizioni; null se il server ha già la revisione [since]. */
    suspend fun state(url: String, token: String, since: Int?): JSONObject? {
        val o = call(url, "GET", "/api/state" + (since?.let { "?since=$it" } ?: ""), token, null)
        return if (o.optBoolean("unchanged")) null else o
    }

    suspend fun ops(url: String, token: String, ops: JSONArray): JSONObject = call(url, "POST", "/api/ops", token, JSONObject().put("ops", ops))

    /** Come esce su Internet il server di casa: VPN sì o no, paese, indirizzo ("label" è già pronto da mostrare). */
    suspend fun network(url: String, token: String): JSONObject = call(url, "GET", "/api/network", token, null)

    suspend fun logout(url: String, token: String) {
        try { call(url, "POST", "/api/logout", token, JSONObject()) } catch (_: Exception) { /* già scollegato */ }
    }

    private suspend fun call(url: String, method: String, path: String, token: String?, body: JSONObject?): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url + path).apply {
            if (token != null) header("Authorization", "Bearer $token")
            when (method) {
                "POST" -> post((body ?: JSONObject()).toString().toRequestBody(json))
                "DELETE" -> delete()
                else -> get()
            }
        }.build()
        try {
            http.newCall(req).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                if (resp.code in 300..399) throw ServerException("Il server risponde con un reindirizzamento: controlla se l'indirizzo è http o https.")
                if (resp.code == 401 && token != null) throw ServerException("Sessione del server scaduta: ricollega il server dalle impostazioni.")
                // Le risposte che sono un elenco arrivano dentro "list".
                val o = try { if (text.trimStart().startsWith("[")) JSONObject().put("list", JSONArray(text)) else JSONObject(text.ifEmpty { "{}" }) } catch (_: Exception) {
                    throw ServerException("A questo indirizzo non risponde IPTVISION. Controlla indirizzo e porta.")
                }
                if (!resp.isSuccessful) throw ServerException(o.optString("error").ifEmpty { "Errore del server (${resp.code})." })
                o
            }
        } catch (e: ServerException) {
            throw e
        } catch (e: UnknownHostException) {
            throw ServerException("Server non trovato: controlla l'indirizzo.")
        } catch (e: ConnectException) {
            throw ServerException("Server non raggiungibile: controlla indirizzo, porta e che il telefono sia nella stessa rete (o su Tailscale).")
        } catch (e: SocketTimeoutException) {
            throw ServerException("Il server non risponde: riprova tra poco.")
        } catch (e: SSLException) {
            throw ServerException("Connessione sicura non riuscita: con l'indirizzo IP di casa usa http://, non https://.")
        } catch (e: IOException) {
            throw ServerException("Server non raggiungibile: ${e.message ?: "errore di rete"}.")
        } catch (e: IllegalArgumentException) {
            throw ServerException("Indirizzo non valido.")
        }
    }
}
