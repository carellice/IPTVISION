package com.carellice.iptvision

import android.app.Application
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.content.pm.PackageManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.carellice.iptvision.data.Category
import com.carellice.iptvision.data.Channel
import com.carellice.iptvision.data.EpgService
import com.carellice.iptvision.data.Entry
import com.carellice.iptvision.data.groupVariants
import com.carellice.iptvision.data.Episode
import com.carellice.iptvision.data.Log
import com.carellice.iptvision.data.Movie
import com.carellice.iptvision.data.PositionStore
import com.carellice.iptvision.data.Series
import com.carellice.iptvision.data.SeriesInfo
import com.carellice.iptvision.data.Settings
import com.carellice.iptvision.data.TextHelpers
import com.carellice.iptvision.data.UpdateInfo
import com.carellice.iptvision.data.UpdateService
import com.carellice.iptvision.data.VodInfo
import com.carellice.iptvision.data.XtreamAccount
import com.carellice.iptvision.data.XtreamClient
import com.carellice.iptvision.data.XtreamException
import com.carellice.iptvision.player.PlayerController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

enum class Section(val title: String) { Live("TV in diretta"), Movies("Film"), Series("Serie TV"), Search("Cerca"), Settings("Impostazioni") }

enum class ListSort(val label: String) {
    Default("Predefinito"), Number("Numero"), NameAsc("Nome (A-Z)"), NameDesc("Nome (Z-A)"),
    Recent("Aggiunti di recente"), Year("Anno (più recenti)"), Rating("Voto");

    companion object {
        fun optionsFor(section: Section) = when (section) {
            Section.Live -> listOf(Default, Number, NameAsc, NameDesc)
            Section.Movies -> listOf(Default, Recent, NameAsc, NameDesc, Year, Rating)
            else -> listOf(Default, NameAsc, NameDesc, Year, Rating)
        }
    }
}

enum class SearchScope(val label: String) { All("Tutto"), Channels("Canali"), Movies("Film"), Series("Serie") }

/** Un titolo pubblicato più volte: si sceglie quale versione aprire. */
sealed interface VariantChoice {
    val title: String
    data class Films(override val title: String, val items: List<Movie>) : VariantChoice
    data class Shows(override val title: String, val items: List<Series>) : VariantChoice
}

sealed interface Screen {
    data object Login : Screen
    data object Home : Screen
    data class MovieDetail(val movie: Movie) : Screen
    data class SeriesDetail(val series: Series) : Screen
    data object Player : Screen
}

sealed interface Playing {
    data class Live(val channel: Channel, val playlist: List<Channel>) : Playing
    data class Film(val movie: Movie) : Playing
    data class Ep(val series: Series, val episode: Episode, val episodes: List<Episode>) : Playing
}

data class Library<T>(val categories: List<Category>, val items: List<T>, val byCategory: Map<String?, List<T>>)

const val ALL_ID = "__all"
const val FAVORITES_ID = "__fav"
const val CONTINUE_ID = "__continue"

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx: Context get() = getApplication()
    private val cacheDir = File(app.filesDir, "cache").apply { mkdirs() }

    /** TV o box Android: interfaccia pensata per il telecomando e avvio diretto dell'ultimo canale. */
    val isTv: Boolean = run {
        val ui = app.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        ui.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            app.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            !app.packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
    }

    val settings = Settings(app, defaultAutoPlay = isTv)
    val positions = PositionStore(File(app.filesDir, "positions.json"))
    val epg = EpgService(cacheDir)
    val player = PlayerController(app)

    var client: XtreamClient? = null; private set

    // ---------- Navigazione ----------
    val stack = mutableStateListOf<Screen>(if (settings.account != null) Screen.Home else Screen.Login)
    val screen: Screen get() = stack.last()
    var section by mutableStateOf(Section.Live)

    fun push(s: Screen) { stack.add(s) }

    /** Restituisce false se non c'è niente da chiudere (l'activity può uscire). */
    fun back(): Boolean {
        if (variantChoice != null) { variantChoice = null; return true }
        if (stack.size > 1) {
            val top = stack.removeAt(stack.lastIndex)
            if (top == Screen.Player) leavePlayer()
            return true
        }
        if (screen == Screen.Home && openCategory(section) != null) { closeCategory(section); return true }
        if (screen == Screen.Home && section != Section.Live) { section = Section.Live; return true }
        return false
    }

    /** C'è qualcosa da chiudere con Indietro prima di uscire dall'app. */
    val canGoBack: Boolean
        get() = variantChoice != null || stack.size > 1 ||
            (screen == Screen.Home && (openCategory(section) != null || section != Section.Live))

    // ---------- Stato ----------
    var status by mutableStateOf<String?>(null); private set
    var error by mutableStateOf<String?>(null)
    var loginBusy by mutableStateOf(false); private set
    var loginError by mutableStateOf<String?>(null)

    var live by mutableStateOf<Library<Channel>?>(null); private set
    var movies by mutableStateOf<Library<Movie>?>(null); private set
    var series by mutableStateOf<Library<Series>?>(null); private set
    var moviesLoading by mutableStateOf(false); private set
    var seriesLoading by mutableStateOf(false); private set

    var favorites by mutableStateOf(settings.favorites); private set
    // Prima si sceglie la categoria, poi si vede l'elenco: null = elenco delle categorie.
    private var liveOpen by mutableStateOf<String?>(null)
    private var moviesOpen by mutableStateOf<String?>(null)
    private var seriesOpen by mutableStateOf<String?>(null)

    fun openCategory(s: Section): String? = when (s) {
        Section.Live -> liveOpen
        Section.Movies -> moviesOpen
        Section.Series -> seriesOpen
        else -> null
    }

    /** L'ultima categoria aperta per sezione: tornando all'elenco il focus riparte da lì. */
    val lastCategory = HashMap<Section, String>()

    fun openCategory(s: Section, id: String) {
        lastCategory[s] = id
        when (s) {
            Section.Live -> { liveOpen = id; settings.lastCategoryId = id }
            Section.Movies -> moviesOpen = id
            Section.Series -> seriesOpen = id
            else -> {}
        }
    }

    fun closeCategory(s: Section) {
        when (s) {
            Section.Live -> liveOpen = null
            Section.Movies -> moviesOpen = null
            Section.Series -> seriesOpen = null
            else -> {}
        }
    }

    // ---------- Ordinamento ed elenco/griglia, ricordati per sezione ----------
    private var sorts by mutableStateOf(Section.entries.associateWith { s ->
        settings.sort(s.name)?.let { v -> ListSort.entries.firstOrNull { it.name == v } } ?: ListSort.Default
    })
    private var grids by mutableStateOf(Section.entries.associateWith { settings.isGrid(it.name) })

    fun sortOf(s: Section): ListSort = sorts[s] ?: ListSort.Default
    fun setSort(s: Section, value: ListSort) {
        sorts = sorts + (s to value)
        settings.setSort(s.name, value.name)
    }

    fun isGrid(s: Section): Boolean = grids[s] == true
    fun setGrid(s: Section, value: Boolean) {
        grids = grids + (s to value)
        settings.setGrid(s.name, value)
    }

    var variantChoice by mutableStateOf<VariantChoice?>(null)

    /** Film dalle liste: se ne esistono più versioni si sceglie prima quale. */
    fun openMovieEntry(e: Entry<Movie>) {
        if (e.hasVariants) variantChoice = VariantChoice.Films(e.item.name, e.variants) else openMovie(e.item)
    }

    fun openSeriesEntry(e: Entry<Series>) {
        if (e.hasVariants) variantChoice = VariantChoice.Shows(e.item.name, e.variants) else openSeries(e.item)
    }

    /** Cambia quando la guida TV o le posizioni si aggiornano: le liste si ridisegnano. */
    var epgVersion by mutableIntStateOf(0); private set
    var positionsVersion by mutableIntStateOf(0); private set
    var settingsVersion by mutableIntStateOf(0); private set

    fun refreshUi() { settingsVersion++ }

    var playing by mutableStateOf<Playing?>(null); private set
    var playError by mutableStateOf<String?>(null)
    var vodInfo by mutableStateOf<VodInfo?>(null); private set
    var seriesInfo by mutableStateOf<SeriesInfo?>(null); private set
    var seriesInfoLoading by mutableStateOf(false); private set
    var nextEpisodeCountdown by mutableStateOf<Int?>(null); private set

    var searchQuery by mutableStateOf("")
        private set

    var update by mutableStateOf<UpdateInfo?>(null); private set
    var updateProgress by mutableStateOf<Float?>(null); private set
    var updateMessage by mutableStateOf<String?>(null); private set

    private var refreshJob: Job? = null
    private var countdownJob: Job? = null

    init {
        player.onEnded = { onPlaybackEnded() }
        player.onFailed = { playError = "Impossibile riprodurre il contenuto."; back() }
        settings.account?.let { openAccount(it, autoPlay = settings.autoPlayLastChannel) }
        if (settings.autoCheckUpdates) checkUpdates(silent = true)
        viewModelScope.launch {
            // Avanzamento dei programmi in onda e salvataggio periodico delle posizioni.
            while (isActive) {
                delay(30_000)
                epgVersion++
                savePosition()
            }
        }
    }

    // ---------- Account ----------
    fun login(serverInput: String, user: String, pass: String) {
        val (server, u, p) = XtreamClient.parseServerInput(serverInput)
        val username = user.trim().ifEmpty { u ?: "" }
        val password = pass.ifEmpty { p ?: "" }
        if (server.isEmpty() || username.isEmpty()) { loginError = "Inserisci server e nome utente, oppure il link M3U completo."; return }
        val account = XtreamAccount(server, username, password)
        loginBusy = true
        loginError = null
        viewModelScope.launch {
            try {
                XtreamClient(account).authenticate()
                settings.server = server
                settings.username = username
                settings.password = password
                stack.clear(); stack.add(Screen.Home)
                section = Section.Live
                openAccount(account, autoPlay = false)
            } catch (e: XtreamException) {
                loginError = e.message
            } catch (e: Exception) {
                loginError = "Impossibile contattare il server. Controlla la connessione."
            } finally {
                loginBusy = false
            }
        }
    }

    fun logout() {
        player.stop()
        playing = null
        refreshJob?.cancel()
        settings.clearAccount()
        client = null
        live = null; movies = null; series = null
        stack.clear(); stack.add(Screen.Login)
    }

    private fun openAccount(account: XtreamAccount, autoPlay: Boolean) {
        val c = XtreamClient(account)
        client = c
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            // Prima la lista salvata: l'app è pronta subito, anche se il server è lento.
            val cached = withContext(Dispatchers.IO) { loadLive(c.account.key) }
            if (cached != null) {
                live = cached
                if (autoPlay) autoPlayLast()
                launch { loadEpg(c, force = false) }
            }
            status = if (cached == null) "Caricamento canali…" else null
            try {
                c.authenticate()
                downloadList(c, "get_live_categories", "live_cats")
                downloadList(c, "get_live_streams", "live", 90)
                val fresh = withContext(Dispatchers.IO) { loadLive(c.account.key) }
                if (fresh != null) live = fresh
                if (cached == null) {
                    if (autoPlay) autoPlayLast()
                    loadEpg(c, force = false)
                }
                status = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: XtreamException) {
                status = null
                if (cached == null || e.isAuthError) error = e.message
            } catch (e: Exception) {
                status = null
                Log.w("Aggiornamento canali fallito", e)
                if (cached == null) error = "Impossibile caricare i canali."
            }
        }
    }

    fun refreshAll() {
        val c = client ?: return
        File(cacheDir, "vod_${c.account.key}.json").delete()
        File(cacheDir, "series_${c.account.key}.json").delete()
        movies = null; series = null
        openAccount(c.account, autoPlay = false)
        viewModelScope.launch { loadEpg(c, force = true) }
        if (section == Section.Movies) ensureMovies()
        if (section == Section.Series) ensureSeries()
    }

    fun clearCache() {
        cacheDir.listFiles()?.forEach { it.delete() }
        refreshAll()
    }

    private fun file(kind: String, key: String) = File(cacheDir, "${kind}_$key.json")

    private suspend fun downloadList(c: XtreamClient, action: String, kind: String, timeoutSec: Long = 30) =
        c.download(action, file(kind, c.account.key), timeoutSec)

    private fun <T> library(cats: List<Category>, items: List<T>, catOf: (T) -> String?): Library<T> {
        val by = items.groupBy(catOf)
        return Library(cats.filter { by[it.id]?.isNotEmpty() == true }, items, by)
    }

    private fun loadLive(key: String): Library<Channel>? {
        val f = file("live", key)
        if (!f.exists()) return null
        return try {
            val cats = file("live_cats", key).takeIf { it.exists() }?.let(XtreamClient::parseCategories) ?: emptyList()
            library(cats, XtreamClient.parseChannels(f), Channel::categoryId)
        } catch (e: Exception) {
            Log.w("Cache canali illeggibile", e); null
        }
    }

    private suspend fun loadEpg(c: XtreamClient, force: Boolean) {
        val ids = live?.items?.mapNotNull { it.epgId }?.distinct() ?: return
        epg.load(c, ids, force)
        epgVersion++
    }

    fun ensureMovies() {
        val c = client ?: return
        if (movies != null || moviesLoading) return
        moviesLoading = true
        viewModelScope.launch {
            try {
                movies = loadOrDownload(c, "vod", "get_vod_categories", "get_vod_streams", XtreamClient::parseMovies, Movie::categoryId)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                error = (e as? XtreamException)?.message ?: "Impossibile caricare i film."
            } finally { moviesLoading = false }
        }
    }

    fun ensureSeries() {
        val c = client ?: return
        if (series != null || seriesLoading) return
        seriesLoading = true
        viewModelScope.launch {
            try {
                series = loadOrDownload(c, "series", "get_series_categories", "get_series", XtreamClient::parseSeries, Series::categoryId)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                error = (e as? XtreamException)?.message ?: "Impossibile caricare le serie."
            } finally { seriesLoading = false }
        }
    }

    /** Film e serie: dalla cache se ha meno di 12 ore, altrimenti dal server. */
    private suspend fun <T> loadOrDownload(
        c: XtreamClient, kind: String, catAction: String, action: String,
        parse: (File) -> List<T>, catOf: (T) -> String?,
    ): Library<T> {
        val key = c.account.key
        val f = file(kind, key)
        val fresh = f.exists() && System.currentTimeMillis() - f.lastModified() < 12 * 3600_000L
        if (!fresh) {
            try {
                downloadList(c, catAction, "${kind}_cats")
                downloadList(c, action, kind, 180)
            } catch (e: Exception) {
                if (!f.exists()) throw e
                Log.w("Aggiornamento $kind fallito, uso la cache", e)
            }
        }
        return withContext(Dispatchers.Default) {
            val cats = file("${kind}_cats", key).takeIf { it.exists() }?.let(XtreamClient::parseCategories) ?: emptyList()
            library(cats, parse(f), catOf)
        }
    }

    // ---------- Liste ----------
    fun channelsFor(categoryId: String): List<Channel> {
        val l = live ?: return emptyList()
        val list = when (categoryId) {
            ALL_ID -> l.items
            FAVORITES_ID -> l.items.filter { it.streamId in favorites }
            else -> l.byCategory[categoryId] ?: emptyList()
        }
        return when (sortOf(Section.Live)) {
            ListSort.Number -> list.sortedBy { if (it.num <= 0) Int.MAX_VALUE else it.num }
            ListSort.NameAsc -> list.sortedBy { it.searchKey }
            ListSort.NameDesc -> list.sortedByDescending { it.searchKey }
            else -> list
        }
    }

    private fun yearValue(y: String?) = y?.toIntOrNull() ?: 0

    fun moviesFor(categoryId: String): List<Entry<Movie>> {
        val l = movies ?: return emptyList()
        val list = when (categoryId) {
            ALL_ID -> l.items
            CONTINUE_ID -> l.items.filter { positions.resumeMs(it.key) > 0 }.sortedByDescending { positions.updatedAt(it.key) ?: 0 }
            else -> l.byCategory[categoryId] ?: emptyList()
        }
        val sorted = when (sortOf(Section.Movies)) {
            ListSort.Recent -> list.sortedByDescending { it.added }
            ListSort.NameAsc -> list.sortedBy { it.searchKey }
            ListSort.NameDesc -> list.sortedByDescending { it.searchKey }
            ListSort.Year -> list.sortedWith(compareByDescending<Movie> { yearValue(it.year) }.thenBy { it.searchKey })
            ListSort.Rating -> list.sortedWith(compareByDescending<Movie> { it.rating }.thenBy { it.searchKey })
            else -> list
        }
        return groupVariants(sorted) { it.name }
    }

    fun seriesFor(categoryId: String): List<Entry<Series>> {
        val l = series ?: return emptyList()
        val list = when (categoryId) {
            ALL_ID -> l.items
            CONTINUE_ID -> l.items.mapNotNull { s -> positions.lastEpisode(s.seriesId)?.let { s to it.second } }
                .sortedByDescending { it.second }.map { it.first }
            else -> l.byCategory[categoryId] ?: emptyList()
        }
        val sorted = when (sortOf(Section.Series)) {
            ListSort.NameAsc -> list.sortedBy { it.searchKey }
            ListSort.NameDesc -> list.sortedByDescending { it.searchKey }
            ListSort.Year -> list.sortedWith(compareByDescending<Series> { yearValue(it.year) }.thenBy { it.searchKey })
            ListSort.Rating -> list.sortedWith(compareByDescending<Series> { it.rating }.thenBy { it.searchKey })
            else -> list
        }
        return groupVariants(sorted) { it.name }
    }

    /** Avanzamento di un titolo raggruppato: il più avanti tra le sue versioni. */
    fun progressOf(e: Entry<Movie>): Float = e.variants.maxOf { positions.progress(it.key) }

    fun toggleFavorite(ch: Channel) {
        favorites = if (ch.streamId in favorites) favorites - ch.streamId else favorites + ch.streamId
        settings.favorites = favorites
    }


    fun ensureShortEpg(ch: Channel) {
        val c = client ?: return
        viewModelScope.launch { if (epg.ensureShort(c, ch)) epgVersion++ }
    }

    // ---------- Ricerca ----------
    data class SearchResults(val channels: List<Channel>, val movies: List<Entry<Movie>>, val series: List<Entry<Series>>) {
        val total get() = channels.size + movies.size + series.size
    }

    var searchScope by mutableStateOf(SearchScope.All)

    fun setQuery(q: String) {
        searchQuery = q
        if (q.isNotBlank() && searchScope != SearchScope.Channels) { ensureMovies(); ensureSeries() }
    }

    fun changeScope(s: SearchScope) {
        searchScope = s
        setQuery(searchQuery)
    }

    fun search(q: String, scope: SearchScope): SearchResults {
        val tokens = TextHelpers.normalize(q).split(' ').filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return SearchResults(emptyList(), emptyList(), emptyList())
        fun ok(key: String) = tokens.all { key.contains(it) }
        fun wants(s: SearchScope) = scope == SearchScope.All || scope == s
        // Le copie dello stesso titolo diventano un solo risultato.
        return SearchResults(
            if (wants(SearchScope.Channels)) live?.items?.filter { ok(it.searchKey) }?.take(60) ?: emptyList() else emptyList(),
            if (wants(SearchScope.Movies)) groupVariants(movies?.items?.filter { ok(it.searchKey) } ?: emptyList()) { it.name }.take(60) else emptyList(),
            if (wants(SearchScope.Series)) groupVariants(series?.items?.filter { ok(it.searchKey) } ?: emptyList()) { it.name }.take(60) else emptyList(),
        )
    }

    // ---------- Riproduzione ----------
    private fun autoPlayLast() {
        val id = settings.lastStreamId ?: return
        if (playing != null) return
        val ch = live?.items?.firstOrNull { it.streamId == id } ?: return
        val cat = settings.lastCategoryId ?: ALL_ID
        playChannel(ch, channelsFor(cat).takeIf { l -> l.any { it.streamId == id } } ?: live!!.items)
    }

    fun playChannel(ch: Channel, playlist: List<Channel>) {
        val c = client ?: return
        savePosition()
        cancelCountdown()
        playing = Playing.Live(ch, playlist)
        settings.lastStreamId = ch.streamId
        player.play(c.liveUrl(ch.streamId, settings.outputFormat), live = true)
        ensureShortEpg(ch)
        if (screen != Screen.Player) push(Screen.Player)
    }

    /** Canale successivo (+1) o precedente (-1) nella lista da cui è stato aperto. */
    fun zap(delta: Int) {
        val p = playing as? Playing.Live ?: return
        val list = p.playlist.ifEmpty { return }
        val i = list.indexOfFirst { it.streamId == p.channel.streamId }
        val next = list[((if (i < 0) 0 else i) + delta).mod(list.size)]
        playChannel(next, list)
    }

    fun playChannelNumber(num: Int): Boolean {
        val ch = live?.items?.firstOrNull { it.num == num } ?: return false
        playChannel(ch, (playing as? Playing.Live)?.playlist ?: live!!.items)
        return true
    }

    fun openMovie(m: Movie) {
        vodInfo = null
        push(Screen.MovieDetail(m))
        val c = client ?: return
        viewModelScope.launch {
            vodInfo = try { c.vodInfo(m.streamId) } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
        }
    }

    fun playMovie(m: Movie, fromStart: Boolean = false) {
        val c = client ?: return
        savePosition()
        cancelCountdown()
        playing = Playing.Film(m)
        player.play(c.movieUrl(m.streamId, m.ext), live = false, resumeMs = if (fromStart) 0 else positions.resumeMs(m.key))
        if (screen != Screen.Player) push(Screen.Player)
    }

    fun openSeries(s: Series) {
        seriesInfo = null
        push(Screen.SeriesDetail(s))
        val c = client ?: return
        seriesInfoLoading = true
        viewModelScope.launch {
            try {
                seriesInfo = c.seriesInfo(s.seriesId)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                error = "Impossibile caricare gli episodi."
            } finally { seriesInfoLoading = false }
        }
    }

    /** L'episodio da cui riprendere: l'ultimo aperto se non finito, altrimenti il successivo. */
    fun resumeEpisode(eps: List<Episode>, seriesId: Int): Episode? {
        if (eps.isEmpty()) return null
        val last = positions.lastEpisode(seriesId)?.first ?: return eps.first()
        val i = eps.indexOfFirst { it.id == last }
        if (i < 0) return eps.first()
        return if (positions.isWatched(eps[i].key)) eps.getOrNull(i + 1) ?: eps[i] else eps[i]
    }

    fun playEpisode(s: Series, ep: Episode, episodes: List<Episode>, fromStart: Boolean = false) {
        val c = client ?: return
        savePosition()
        cancelCountdown()
        playing = Playing.Ep(s, ep, episodes)
        positions.setLastEpisode(s.seriesId, ep.id)
        player.play(c.episodeUrl(ep.id, ep.extension), live = false, resumeMs = if (fromStart) 0 else positions.resumeMs(ep.key))
        if (screen != Screen.Player) push(Screen.Player)
    }

    fun nextEpisode(): Episode? {
        val p = playing as? Playing.Ep ?: return null
        val i = p.episodes.indexOfFirst { it.id == p.episode.id }
        return p.episodes.getOrNull(i + 1)
    }

    fun playNextEpisode() = playEpisodeOffset(+1)

    /** Episodio successivo (+1) o precedente (-1) della serie in riproduzione. */
    fun playEpisodeOffset(delta: Int) {
        val p = playing as? Playing.Ep ?: return
        val i = p.episodes.indexOfFirst { it.id == p.episode.id }
        val ep = p.episodes.getOrNull(i + delta) ?: return
        playEpisode(p.series, ep, p.episodes, fromStart = delta > 0)
    }

    private fun onPlaybackEnded() {
        when (val p = playing) {
            is Playing.Film -> { positions.markWatched(p.movie.key); positionsVersion++; back() }
            is Playing.Ep -> {
                positions.markWatched(p.episode.key)
                positionsVersion++
                if (nextEpisode() == null) { back(); return }
                // Alla fine di un episodio parte il successivo dopo 10 secondi, annullabile.
                countdownJob = viewModelScope.launch {
                    for (s in 10 downTo 1) { nextEpisodeCountdown = s; delay(1000) }
                    nextEpisodeCountdown = null
                    playNextEpisode()
                }
            }
            else -> {}
        }
    }

    fun cancelCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        nextEpisodeCountdown = null
    }

    fun savePosition(force: Boolean = false) {
        val key = when (val p = playing) {
            is Playing.Film -> p.movie.key
            is Playing.Ep -> p.episode.key
            else -> null
        }
        if (key != null && player.isActive) {
            if (positions.update(key, player.currentPosition(), player.currentDuration())) positionsVersion++
        }
        positions.save(force)
    }

    private fun leavePlayer() {
        savePosition(force = true)
        positionsVersion++
        cancelCountdown()
        player.stop()
        playing = null
    }

    fun onStop() {
        savePosition(force = true)
    }

    // ---------- Aggiornamenti ----------
    fun checkUpdates(silent: Boolean) {
        viewModelScope.launch {
            if (!silent) updateMessage = "Controllo in corso…"
            try {
                update = UpdateService.check()
                updateMessage = if (update == null) "Hai già l'ultima versione (${UpdateService.currentVersion})." else null
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                Log.w("Controllo aggiornamenti fallito", e)
                updateMessage = if (silent) null else "Impossibile controllare gli aggiornamenti."
            }
        }
    }

    fun installUpdate() {
        val u = update ?: return
        if (updateProgress != null) return
        if (!UpdateService.canInstall(ctx)) {
            updateMessage = "Consenti a IPTVISION di installare app, poi premi di nuovo Aggiorna."
            UpdateService.openInstallPermission(ctx)
            return
        }
        updateProgress = 0f
        updateMessage = null
        viewModelScope.launch {
            try {
                val apk = UpdateService.download(ctx, u) { p -> viewModelScope.launch(Dispatchers.Main) { updateProgress = p } }
                updateProgress = null
                UpdateService.install(ctx, apk)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                Log.w("Download aggiornamento fallito", e)
                updateProgress = null
                updateMessage = "Download non riuscito. Riprova."
            }
        }
    }

    override fun onCleared() {
        savePosition(force = true)
        player.release()
    }
}
