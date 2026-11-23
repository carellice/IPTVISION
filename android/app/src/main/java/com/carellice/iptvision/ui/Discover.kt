package com.carellice.iptvision.ui

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Tv
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.ui.focus.focusRequester
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.carellice.iptvision.ALL_ID
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.CONTINUE_ID
import com.carellice.iptvision.MYLIST_ID
import com.carellice.iptvision.Section
import com.carellice.iptvision.data.Entry
import com.carellice.iptvision.data.Movie
import com.carellice.iptvision.data.Series
import com.carellice.iptvision.data.Tmdb
import com.carellice.iptvision.data.groupVariants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import kotlinx.coroutines.launch
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Dp
import com.carellice.iptvision.Library

// "Film e serie" con la chiave TMDB: film e serie in una sola schermata, come le app di streaming.
// In alto un titolo di tendenza che cambia da solo, poi le righe: continua a guardare, la mia lista,
// tendenze, generi e in fondo le categorie della lista. Come PWA/web/src/screens/Discover.tsx.

/** Un titolo del catalogo con la sua scheda TMDB, se trovata. */
private class Title(val movie: Entry<Movie>?, val show: Entry<Series>?, val tmdb: Tmdb.Card?) {
    val isMovie get() = movie != null
    val key: String get() = movie?.item?.key ?: show!!.item.key
    val name: String get() = movie?.item?.name ?: show!!.item.name
    val year: String? get() = movie?.item?.year ?: show?.item?.year
    val initials: String get() = movie?.item?.initials ?: show!!.item.initials
    val poster: String? get() = movie?.item?.poster ?: show?.item?.cover
    val kind get() = if (isMovie) Tmdb.Kind.Movie else Tmdb.Kind.Tv
}

private fun Entry<Movie>.title(t: Tmdb.Card? = null) = Title(this, null, t)
@JvmName("seriesTitle") private fun Entry<Series>.title(t: Tmdb.Card? = null) = Title(null, this, t)

private enum class Filter { All, Movie, Tv }

/** Sul TV righe e locandine col focus si fermano sempre allo stesso punto. */
private val LocalTvPin = compositionLocalOf { false }

/** Aperta dal menu, la pagina riparte dall'inizio. */
fun resetDiscoverScroll() { Saved.index = 0; Saved.offset = 0; Saved.rows.clear(); Saved.focusAll = null; Saved.focusTitle = null }

/**
 * Sul TV la riga o la locandina col focus si porta sempre allo stesso punto (in alto, a sinistra) invece
 * di scorrere il minimo indispensabile: lo sguardo resta fermo, come in Netflix o Prime Video.
 */
@OptIn(ExperimentalFoundationApi::class)
private fun pinTo(leadPx: Float) = object : BringIntoViewSpec {
    // Curva fissa e non la molla predefinita: con i tasti premuti in fretta la molla accumula velocità e
    // supera il punto, poi torna indietro (il "rimbalzo").
    @Deprecated("") override val scrollAnimationSpec: androidx.compose.animation.core.AnimationSpec<Float> =
        tween(180, easing = androidx.compose.animation.core.CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f))
    // Al pixel intero e senza correzioni sotto il pixel: gli arrotondamenti non spostano la riga.
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float) =
        (offset - leadPx).let { if (kotlin.math.abs(it) < 1.5f) 0f else it }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TvRow(content: @Composable () -> Unit) {
    if (!LocalTvPin.current) { content(); return }
    val lead = with(LocalDensity.current) { (LocalEdge.current + 2.dp).roundToPx().toFloat() }
    CompositionLocalProvider(LocalBringIntoViewSpec provides remember(lead) { pinTo(lead) }, content = content)
}

/** Dove si era quando si è aperto un titolo o una categoria, per tornare allo stesso punto. */
private object Saved {
    var filter = Filter.All; var index = 0; var offset = 0
    /** Con "Tutto": le categorie della lista mostrate in fondo, dei film o delle serie (mai insieme). */
    var catSeries = false
    /** Fin dove era scorsa ogni riga, per titolo. */
    val rows = HashMap<String, Pair<Int, Int>>()
    /** La riga da cui si è aperto "Guarda tutto": al ritorno il focus torna lì. */
    var focusAll: String? = null
    /** Il riquadro aperto (riga|titolo): tornando dalla scheda o dal player il focus riparte da lì, non dal menu. */
    var focusTitle: String? = null
    /** Righe TMDB già confrontate col catalogo: tornando alla pagina non si rifà il lavoro (e la pagina non salta). */
    var matchKey: List<Any?>? = null
    var match: List<Pair<Tmdb.Row, List<Title>>>? = null
}

/** La riga in cui sta un riquadro: lo stesso titolo può stare in più righe. */
private val LocalRowId = androidx.compose.runtime.compositionLocalOf { "" }

/** Focus da rimettere sul riquadro al ritorno; la funzione restituita va chiamata all'apertura. */
@Composable
private fun returnFocus(t: Title): Pair<Modifier, () -> Unit> {
    val id = LocalRowId.current + "|" + t.key
    val me = remember { FocusRequester() }
    if (Saved.focusTitle == id) LaunchedEffect(Unit) { Saved.focusTitle = null; delay(60); runCatching { me.requestFocus() } }
    return Modifier.focusRequester(me) to { Saved.focusTitle = id }
}

private fun AppViewModel.openTitle(t: Title) {
    if (t.movie != null) openMovieEntry(t.movie) else openSeriesEntry(t.show!!)
}

/** I film partono subito (da dove si era rimasti), le serie aprono gli episodi. */
private fun AppViewModel.playTitle(t: Title) {
    if (t.movie != null && !t.movie.hasVariants) playMovie(t.movie.item) else openTitle(t)
}

private fun AppViewModel.progressOf(t: Title) = t.movie?.let { progressOf(it) } ?: 0f

/** La scheda TMDB già nota (dalle righe), altrimenti chiesta a TMDB; nulla se [enabled] è falso. */
@Composable
internal fun rememberTmdb(vm: AppViewModel, kind: Tmdb.Kind, name: String, year: String?, known: Tmdb.Card? = null, enabled: Boolean = true): Tmdb.Card? {
    val key = vm.tmdbKey
    val v by produceState(known, kind, name, year, known, enabled, key) {
        value = known ?: if (enabled && key.isNotEmpty()) Tmdb.lookup(key, kind, name, year) else null
    }
    return v
}

@Composable
fun DiscoverSection(vm: AppViewModel) {
    val open = vm.discoverOpen
    if (open != null) CategoryGrid(vm, open) else DiscoverHome(vm)
}

@Composable
private fun DiscoverHome(vm: AppViewModel) {
    LaunchedEffect(vm.tmdbKey) { vm.ensureTmdb() }
    val wide = LocalWide.current
    val edge = LocalEdge.current
    // Si mostra appena c'è uno dei due cataloghi: l'altro (e TMDB) arriva dopo, senza bloccare la pagina.
    if (vm.movies == null && vm.series == null) {
        Box(Modifier.fillMaxSize()) {
            DiscoverSkeleton(wide, edge)
            LoadingBadge(vm, null)
        }
        return
    }
    val movies = vm.movies ?: Library(emptyList(), emptyList(), emptyMap())
    val series = vm.series ?: Library(emptyList(), emptyList(), emptyMap())
    var filter by remember { mutableStateOf(Saved.filter) }
    fun pass(t: Title) = filter == Filter.All || (filter == Filter.Movie) == t.isMovie
    var categories by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<Pair<Title, Boolean>?>(null) } // titolo, dalla mia lista

    // Le liste di TMDB diventano titoli del catalogo, ognuno una volta per riga (lavoro pesante: fuori dal thread della UI).
    val rows = vm.tmdbRows
    val matchKey = listOf(System.identityHashCode(movies), System.identityHashCode(series), System.identityHashCode(rows))
    val known0 = Saved.match.takeIf { Saved.matchKey == matchKey && rows != null }
    val matched by produceState(known0, movies, series, rows) {
        if (rows == null) { value = null; return@produceState }
        if (known0 != null) { value = known0; return@produceState }
        value = withContext(Dispatchers.Default) {
            val index = Tmdb.index(movies.items, series.items)
            rows.map { r ->
                val seen = HashSet<String>()
                r to r.items.mapNotNull { c ->
                    @Suppress("UNCHECKED_CAST")
                    val t = when (val e = Tmdb.find(c, index)) {
                        null -> null
                        else -> if (c.kind == Tmdb.Kind.Movie) (e as Entry<Movie>).title(c) else (e as Entry<Series>).title(c)
                    }
                    t?.takeIf { seen.add(it.key) }
                }
            }
        }
        Saved.matchKey = matchKey; Saved.match = value
    }
    val known = remember(matched) { matched.orEmpty().flatMap { it.second }.associate { it.key to it.tmdb } }

    val continueRow = remember(movies, series, vm.positionsVersion) {
        val ms = vm.moviesFor(CONTINUE_ID).map { e -> e.title() to e.variants.maxOf { vm.positions.updatedAt(it.key) ?: 0L } }
        val ss = vm.seriesFor(CONTINUE_ID).map { e -> e.title() to (vm.positions.lastEpisode(e.item.seriesId)?.second ?: 0L) }
        (ms + ss).sortedByDescending { it.second }.map { it.first }
    }
    val listRow = remember(movies, series, vm.positionsVersion) {
        val order = vm.positions.myList().withIndex().associate { it.value to it.index }
        (vm.moviesFor(MYLIST_ID).map { it.title() } + vm.seriesFor(MYLIST_ID).map { it.title() })
            .sortedBy { t -> order[t.key] ?: Int.MAX_VALUE }
    }
    val recent = remember(movies) {
        groupVariants(movies.items.sortedByDescending { it.added }.take(80)) { it.variantKey }.take(30).map { it.title() }
    }
    val tmdbRows = remember(matched, filter) {
        matched.orEmpty().map { (r, ts) -> r to ts.filter(::pass) }.filter { (r, ts) -> ts.size >= if (r.top) 5 else 4 }
    }
    // Le categorie della lista: riquadri a griglia (nome e quanti titoli), quelle vuote no.
    val movieCats = if (filter == Filter.Tv) emptyList() else movies.categories.mapNotNull { c -> movies.byCategory[c.id]?.size?.takeIf { it > 0 }?.let { ProviderCat(true, c.id, c.name, it) } }
    val seriesCats = if (filter == Filter.Movie) emptyList() else series.categories.mapNotNull { c -> series.byCategory[c.id]?.size?.takeIf { it > 0 }?.let { ProviderCat(false, c.id, c.name, it) } }
    // Con "Tutto" un selettore Film / Serie TV: le categorie di un tipo alla volta.
    val catSwitch = movieCats.isNotEmpty() && seriesCats.isNotEmpty()
    var catSeries by remember { mutableStateOf(Saved.catSeries) }
    val providerCats = if (if (catSwitch) catSeries else movieCats.isEmpty()) seriesCats else movieCats

    // Liste di TMDB ancora in arrivo: al loro posto riquadri che pulsano, il resto della pagina è già usabile.
    val tmdbPending = matched == null && vm.tmdbError == null
    val state = rememberLazyListState(Saved.index, Saved.offset)
    DisposableEffect(Unit) { onDispose { Saved.index = state.firstVisibleItemIndex; Saved.offset = state.firstVisibleItemScrollOffset } }
    val gap = if (wide) 26.dp else 20.dp
    // Telefono in orizzontale (largo ma basso): 4 colonne di categorie, con 5 i nomi non si leggevano.
    val cols = if (!wide) 2 else if (androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp < 500) 4 else 5

    val chips = @Composable { m: Modifier ->
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = edge + 2.dp, vertical = 2.dp), modifier = m) {
            item {
                // TV: scelta la sezione dal menu, il focus parte da qui, in cima alla pagina.
                val first = remember { androidx.compose.ui.focus.FocusRequester() }
                if (vm.isTv && vm.focusContent) LaunchedEffect(Unit) { vm.focusContent = false; runCatching { first.requestFocus() } }
                Pill("Tutto", filter == Filter.All, modifier = Modifier.focusRequester(first)) { filter = Filter.All; Saved.filter = filter }
            }
            item { Pill("Film", filter == Filter.Movie) { filter = Filter.Movie; Saved.filter = filter } }
            item { Pill("Serie TV", filter == Filter.Tv) { filter = Filter.Tv; Saved.filter = filter } }
            item { Pill("Categorie", false, Icons.Default.KeyboardArrowDown) { categories = true } }
        }
    }
    val tv = vm.isTv && wide
    val density = LocalDensity.current

    Box(Modifier.fillMaxSize()) {
    val pinRows = remember(density) { with(density) { pinTo(44.dp.roundToPx().toFloat()) } }
    @OptIn(ExperimentalFoundationApi::class)
    CompositionLocalProvider(LocalTvPin provides tv, LocalBringIntoViewSpec provides (if (tv) pinRows else LocalBringIntoViewSpec.current)) {
    LazyColumn(state = state, modifier = Modifier.fillMaxSize(), overscrollEffect = if (tv) null else androidx.compose.foundation.rememberOverscrollEffect(), contentPadding = PaddingValues(bottom = if (tv) 300.dp else 30.dp)) {
        item("chips") { chips(Modifier.padding(top = if (edge > 0.dp) 12.dp else 0.dp, bottom = 12.dp)) }
        vm.tmdbError?.let { e ->
            item("error") { Text("$e Controlla la chiave in Impostazioni → TMDB.", color = C.Danger, fontSize = 14.sp, modifier = Modifier.padding(start = edge + 2.dp, top = 12.dp, end = edge)) }
        }

        continueRow.filter(::pass).takeIf { it.isNotEmpty() }?.let { list ->
            item("continue") {
                DRow("Continua a guardare", gap) {
                    items(list, key = { it.key }) { t -> WideTile(vm, t, known[t.key]) { remove = t to false } }
                }
            }
        }
        listRow.filter(::pass).takeIf { it.isNotEmpty() }?.let { list ->
            item("mylist") {
                DRow("La mia lista", gap) {
                    items(list, key = { it.key }) { t -> PosterTile(vm, t, known[t.key], lookup = true) { remove = t to true } }
                }
            }
        }
        if (tmdbPending) items(3, key = { "skel$it" }) { RowSkeleton(wide, edge, gap) }
        tmdbRows.forEachIndexed { i, (r, ts) ->
            item(r.id) {
                DRow(if (r.top) "${r.title} in Italia" else r.title, gap, id = "t:${r.id}") {
                    if (r.top) itemsIndexed(ts.take(10), key = { _, t -> t.key }) { n, t -> TopTile(vm, t, n + 1) }
                    else items(ts.take(40), key = { it.key }) { t -> PosterTile(vm, t, t.tmdb) }
                }
            }
            if (i == 1 && filter != Filter.Tv && recent.isNotEmpty()) item("recent") {
                DRow("Aggiunti di recente", gap, onAll = { vm.openCategory(Section.Discover, "m:$ALL_ID") }) {
                    items(recent, key = { it.key }) { t -> PosterTile(vm, t, known[t.key], lookup = true) }
                }
            }
        }
        if (matched != null && tmdbRows.isEmpty() && vm.tmdbError == null) item("none") {
            Text("Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista.", color = C.Text2, fontSize = 14.sp, modifier = Modifier.padding(top = 20.dp, start = edge + 2.dp, end = edge))
        }
        item("cats") {
            Text("Le categorie della lista", color = C.Text, fontSize = if (wide) 24.sp else 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = if (wide) 44.dp else 32.dp, start = edge + 2.dp))
        }
        if (catSwitch) item("catSwitch") {
            Row(Modifier.padding(start = edge + 2.dp, top = if (wide) 14.dp else 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("Film", !catSeries) { catSeries = false; Saved.catSeries = false }
                Pill("Serie TV", catSeries) { catSeries = true; Saved.catSeries = true }
            }
        }
        items(providerCats.chunked(cols), key = { r -> "c:" + r.first().key }) { row ->
            Row(Modifier.padding(start = edge + 2.dp, end = edge + 2.dp, top = if (wide) 14.dp else 10.dp), horizontalArrangement = Arrangement.spacedBy(if (wide) 14.dp else 10.dp)) {
                row.forEach { c ->
                    CatTile(c, Modifier.weight(1f), restore = Saved.focusAll == c.key) {
                        Saved.focusAll = c.key
                        vm.openCategory(Section.Discover, "${if (c.isMovie) "m" else "s"}:${c.id}")
                    }
                }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
    }
    LoadingBadge(vm, if (tmdbPending && vm.hasTmdb) "Preparo le tendenze…" else null)
    }

    if (categories) CategoriesDialog(vm, filter) { categories = false }
    remove?.let { (t, fromList) ->
        RemoveContinueDialog(t.name, fromList, { remove = null }) {
            remove = null
            when {
                fromList && t.movie != null -> vm.toggleMyList(t.movie.item)
                fromList -> vm.toggleMyList(t.show!!.item)
                t.movie != null -> vm.removeMovieFromContinue(t.movie)
                else -> vm.removeSeriesFromContinue(t.show!!)
            }
        }
    }
}

private data class ProviderCat(val isMovie: Boolean, val id: String, val name: String, val count: Int) {
    val key get() = "c:$isMovie:$id"
}

/** Una categoria della lista: si apre a griglia con tutti i suoi titoli. */
@Composable
private fun CatTile(c: ProviderCat, modifier: Modifier, restore: Boolean, onClick: () -> Unit) {
    val me = remember { FocusRequester() }
    // Tornando dalla categoria il focus riparte da qui.
    if (restore) LaunchedEffect(Unit) { Saved.focusAll = null; delay(60); runCatching { me.requestFocus() } }
    Column(
        modifier.height(96.dp).focusRequester(me)
            .tvClickable(background = if (Skin.metro) C.Accent else C.Surface, onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (c.isMovie) Icons.Default.Movie else Icons.Default.Tv, null, tint = if (Skin.metro) Color.White else C.Text2, modifier = Modifier.size(20.dp))
            Box(Modifier.weight(1f))
            Text(c.count.toString(), color = if (Skin.metro) Color.White else C.Text3, fontSize = 13.sp)
        }
        Text(c.name, color = C.Text, fontWeight = if (Skin.metro) FontWeight.Normal else FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

// ---------- Le righe ----------

@Composable
private fun DRow(title: String, top: androidx.compose.ui.unit.Dp, id: String = title, onAll: (() -> Unit)? = null, captions: Boolean = false, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    val wide = LocalWide.current
    val edge = LocalEdge.current
    Column(Modifier.padding(top = top)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = edge + 2.dp)) {
            Text(title, color = C.Text, fontSize = if (wide) 20.sp else 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        }
        val tv = LocalTvPin.current
        val st = rememberLazyListState(Saved.rows[id]?.first ?: 0, Saved.rows[id]?.second ?: 0)
        DisposableEffect(id) { onDispose { Saved.rows[id] = st.firstVisibleItemIndex to st.firstVisibleItemScrollOffset } }
        // Un FocusRequester per riquadro (per posizione nella riga), per scegliere dove entra il focus.
        val reqs = remember { HashMap<Int, FocusRequester>() }
        // TV: arrivando con ▲ ▼ da un'altra riga il focus va sul riquadro fermo a sinistra (il primo, se la riga
        // non è scorsa) e la riga resta com'è: nessuno scorrimento di lato mentre ci si sposta in verticale.
        @OptIn(ExperimentalComposeUiApi::class)
        // Ogni riga ha un id suo (non il nome): le categorie della lista che si chiamano come una riga TMDB
        // ("Animazione", "Horror"…) non ereditano più scorrimento e focus dell'altra riga.
        val enter = if (!tv) Modifier else Modifier.focusProperties {
            onEnter = {
                if (requestedFocusDirection == FocusDirection.Up || requestedFocusDirection == FocusDirection.Down) {
                    val k = st.layoutInfo.visibleItemsInfo.firstOrNull { it.offset >= -it.size / 4 }?.index ?: st.firstVisibleItemIndex
                    reqs[k]?.let { r -> runCatching { r.requestFocus() } }
                }
            }
        }.focusGroup()
        // Spazio attorno per il riquadro che si ingrandisce quando ha il focus.
        CompositionLocalProvider(LocalRowId provides id) { TvRow { LazyRow(state = st, modifier = enter, overscrollEffect = if (tv) null else androidx.compose.foundation.rememberOverscrollEffect(), horizontalArrangement = Arrangement.spacedBy(if (wide) 10.dp else 8.dp), contentPadding = PaddingValues(horizontal = edge + 2.dp, vertical = 10.dp)) {
            Tagged(this, reqs).apply(content).item("__all", onAll != null) { SeeAllTile(captions, restore = Saved.focusAll == id) { Saved.focusAll = id; onAll?.invoke() } }
        } } }
    }
}

@Composable
private fun PosterTile(vm: AppViewModel, t: Title, known: Tmdb.Card?, lookup: Boolean = false, caption: Boolean = false, onLong: (() -> Unit)? = null) {
    val wide = LocalWide.current
    val tm = rememberTmdb(vm, t.kind, t.name, t.year, known, lookup)
    val p = vm.progressOf(t)
    val (back, opened) = returnFocus(t)
    Column(Modifier.width(if (wide) 154.dp else 112.dp).then(back).tvClickable(shape = RoundedCornerShape(8.dp), focusScale = 1.08f, background = Color.Transparent, focusedBackground = Color.Transparent, onLongClick = onLong) { opened(); vm.openTitle(t) }) {
        Box {
            Artwork(Tmdb.img(tm?.poster) ?: t.poster, t.initials, Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(skinCorners(8.dp)), fontSize = 20)
            if (p > 0f && p < 1f) ProgressLine(p, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp))
            if (!t.isMovie && !caption) KindBadge()
        }
        if (caption) Text(t.name, color = C.Text2, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
}

/** In fondo alla riga, grande come una locandina: apre tutti i titoli della categoria. */
@Composable
private fun SeeAllTile(captions: Boolean, restore: Boolean, onClick: () -> Unit) {
    val wide = LocalWide.current
    val me = remember { FocusRequester() }
    // Tornando da "Guarda tutto" il focus riparte da qui.
    if (restore) LaunchedEffect(Unit) { Saved.focusAll = null; delay(60); runCatching { me.requestFocus() } }
    // Alta come le locandine della riga (titolo sotto compreso): così ▲ ▼ escono dalla riga anche da qui.
    Column(
        Modifier.width(if (wide) 154.dp else 112.dp).focusRequester(me)
            .tvClickable(shape = RoundedCornerShape(8.dp), focusScale = 1.08f, background = Color.Transparent, focusedBackground = Color.Transparent, onClick = onClick),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).background(C.Surface), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(if (wide) 46.dp else 38.dp).clip(CircleShape).border(2.dp, C.Text2, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = C.Text, modifier = Modifier.size(if (wide) 24.dp else 20.dp))
                }
                Text("Guarda tutto", color = C.Text, fontSize = if (wide) 15.sp else 13.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp))
            }
        }
        if (captions) Box(Modifier.height(38.dp))
    }
}

/** Ogni riquadro della riga avvolto col suo FocusRequester, indicizzato per posizione. */
private class Tagged(private val inner: LazyListScope, private val reqs: HashMap<Int, FocusRequester>) : LazyListScope by inner {
    private var next = 0
    private fun req(i: Int) = reqs.getOrPut(i) { FocusRequester() }

    override fun item(key: Any?, contentType: Any?, content: @Composable LazyItemScope.() -> Unit) {
        val f = req(next++)
        inner.item(key, contentType) { Box(Modifier.focusRequester(f)) { content() } }
    }

    override fun items(count: Int, key: ((Int) -> Any)?, contentType: (Int) -> Any?, itemContent: @Composable LazyItemScope.(Int) -> Unit) {
        val base = next
        next += count
        val r = reqs
        inner.items(count, key, contentType) { i -> Box(Modifier.focusRequester(r.getOrPut(base + i) { FocusRequester() })) { itemContent(i) } }
    }

    fun item(key: Any, show: Boolean, content: @Composable LazyItemScope.() -> Unit) { if (show) item(key, null, content) }
}

@Composable
private fun KindBadge() {
    Text(
        "SERIE", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp,
        modifier = Modifier.padding(6.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xB3000000)).padding(horizontal = 5.dp, vertical = 2.dp),
    )
}

@Composable
private fun TopTile(vm: AppViewModel, t: Title, n: Int) {
    val wide = LocalWide.current
    val h = if (wide) 210.dp else 150.dp
    val (back, opened) = returnFocus(t)
    Row(
        Modifier.height(h).then(back).tvClickable(shape = RoundedCornerShape(8.dp), background = Color.Transparent, focusedBackground = Color.Transparent) { opened(); vm.openTitle(t) }.padding(end = 4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        // Il numero grande col solo contorno, mezzo nascosto dietro la locandina (come su Windows).
        RankNumber(n, h * (150f / 210f), Modifier.offset(x = h * (22f / 210f)))
        Artwork(Tmdb.img(t.tmdb?.poster) ?: t.poster, t.initials, Modifier.fillMaxHeight().aspectRatio(2f / 3f).clip(skinCorners(8.dp)), fontSize = 18)
    }
}

/**
 * Cifre della classifica come su Windows: il disegno del numero pieno del colore di fondo, con un contorno sottile.
 * Disegnate come sagoma e non come testo, così il 10 non si accavalla e niente viene tagliato sopra o sotto.
 */
@Composable
private fun RankNumber(n: Int, height: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val fill = C.Bg
    val line = C.Text3
    val (glyphs, bounds) = remember(n) {
        val path = android.graphics.Path()
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            typeface = android.graphics.Typeface.create("sans-serif-black", android.graphics.Typeface.NORMAL)
            textSize = 190f
        }.getTextPath("$n", 0, "$n".length, 0f, 0f, path)
        path to android.graphics.RectF().also { path.computeBounds(it, true) }
    }
    if (bounds.height() <= 0f) return
    androidx.compose.foundation.Canvas(modifier.size(height * (bounds.width() / bounds.height()), height)) {
        val stroke = size.height * 2.5f / 150f
        val k = (size.height - stroke) / bounds.height()
        val p = android.graphics.Path(glyphs).apply {
            transform(android.graphics.Matrix().apply { setTranslate(-bounds.left, -bounds.top); postScale(k, k); postTranslate(stroke / 2, stroke / 2) })
        }.asComposePath()
        drawPath(p, fill)
        drawPath(p, line, style = Stroke(width = stroke, join = androidx.compose.ui.graphics.StrokeJoin.Round))
    }
}

/** Continua a guardare: la scena del titolo con l'avanzamento, come fanno i servizi di streaming. */
@Composable
private fun WideTile(vm: AppViewModel, t: Title, known: Tmdb.Card?, onLong: () -> Unit) {
    val wide = LocalWide.current
    val tm = rememberTmdb(vm, t.kind, t.name, t.year, known)
    val p = vm.progressOf(t)
    val (back, opened) = returnFocus(t)
    Column(Modifier.width(if (wide) 290.dp else 220.dp).then(back).tvClickable(shape = RoundedCornerShape(8.dp), background = Color.Transparent, focusedBackground = Color.Transparent, onLongClick = onLong) { opened(); vm.playTitle(t) }) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(skinCorners(8.dp))) {
            Artwork(Tmdb.img(tm?.backdrop, "w780") ?: t.poster, t.initials, Modifier.fillMaxSize(), fontSize = 20)
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xB3000000))))
            Box(
                Modifier.align(Alignment.BottomStart).padding(start = 10.dp, bottom = 12.dp).size(34.dp).clip(CircleShape)
                    .background(Color(0x73000000)).border(2.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.PlayArrow, null, tint = Color.White, modifier = Modifier.size(22.dp)) }
            if (p > 0f && p < 1f) ProgressLine(p, Modifier.align(Alignment.BottomCenter).fillMaxWidth(), height = 4.dp)
        }
        Text(tm?.title?.ifEmpty { null } ?: t.name, color = C.Text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        val sub = if (t.isMovie) "Film" else if (vm.positions.lastEpisode(t.show!!.item.seriesId) != null) "Serie TV · riprendi l'episodio" else "Serie TV"
        Text(sub, color = C.Text3, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------- Tutti i titoli di una categoria ----------

@Composable
private fun CategoryGrid(vm: AppViewModel, id: String) {
    val isMovie = id.startsWith("m:")
    val catId = id.drop(2)
    val wide = LocalWide.current
    val lib = if (isMovie) vm.movies else vm.series
    if (lib == null) { DownloadProgress(if (isMovie) "Caricamento film…" else "Caricamento serie…", if (isMovie) vm.moviesProgress else vm.seriesProgress); return }
    val name = if (catId == ALL_ID) (if (isMovie) "Tutti i film" else "Tutte le serie") else lib.categories.firstOrNull { it.id == catId }?.name ?: ""
    val section = if (isMovie) Section.Movies else Section.Series
    val edge = LocalEdge.current
    Column(Modifier.fillMaxSize().padding(start = edge, end = edge, top = if (edge > 0.dp) 12.dp else 0.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
            if (!vm.isTv) Box(Modifier.tvClickable(shape = CircleShape, background = Color.Transparent) { vm.closeCategory(Section.Discover) }.padding(10.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro", tint = C.Text)
            }
            Column(Modifier.weight(1f).padding(start = 6.dp)) {
                Text(name, color = C.Text, fontSize = if (wide) 24.sp else 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            SortButton(vm, section, compact = !wide)
        }
        Box(Modifier.weight(1f)) {
            if (isMovie) {
                val list = remember(lib, catId, vm.positionsVersion, vm.sortOf(section)) { vm.moviesFor(catId) }
                EntryList(vm, section, list, true, key = { it.streamId }) { e, mod, _ ->
                    val m = e.item
                    Poster(m.name, m.meta, m.poster, m.initials, vm.progressOf(e), e.variantsText.takeIf { e.hasVariants }, mod, null) {
                        vm.lastEntry[section] = m.streamId; vm.openMovieEntry(e)
                    }
                }
            } else {
                val list = remember(lib, catId, vm.positionsVersion, vm.sortOf(section)) { vm.seriesFor(catId) }
                EntryList(vm, section, list, true, key = { it.seriesId }) { e, mod, _ ->
                    val s = e.item
                    Poster(s.name, s.meta, s.cover, s.initials, 0f, e.variantsText.takeIf { e.hasVariants }, mod, null) {
                        vm.lastEntry[section] = s.seriesId; vm.openSeriesEntry(e)
                    }
                }
            }
        }
    }
}

@Composable
private fun CategoriesDialog(vm: AppViewModel, filter: Filter, onDismiss: () -> Unit) {
    val groups = buildList {
        if (filter != Filter.Tv) add(Triple("m", "Film", listOf(ALL_ID to "Tutti i film") + vm.movies?.categories.orEmpty().map { it.id to it.name }))
        if (filter != Filter.Movie) add(Triple("s", "Serie TV", listOf(ALL_ID to "Tutte le serie") + vm.series?.categories.orEmpty().map { it.id to it.name }))
    }
    Dialog(onDismissRequest = onDismiss) {
        LazyColumn(Modifier.widthIn(max = 520.dp).heightIn(max = 560.dp).clip(skinCorners(18.dp)).material(C.Panel), contentPadding = PaddingValues(vertical = 8.dp)) {
            groups.forEach { (k, title, cats) ->
                item("h$k") { Text(title.uppercase(), color = C.Text3, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 6.dp)) }
                items(cats, key = { "$k:${it.first}" }) { (id, name) ->
                    Text(
                        name, color = C.Text, fontSize = 15.sp, fontWeight = if (id == ALL_ID) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth().tvClickable(shape = RoundedCornerShape(0.dp), focusScale = 1f, background = Color.Transparent) {
                            onDismiss(); vm.openCategory(Section.Discover, "$k:$id")
                        }.padding(horizontal = 20.dp, vertical = 11.dp),
                    )
                }
            }
        }
    }
}

// ---------- Caricamento ----------

/** Riquadro che pulsa al posto di un contenuto in arrivo. */
@Composable
private fun Modifier.shimmer(): Modifier {
    val x by rememberInfiniteTransition(label = "shimmer").animateFloat(-1f, 2f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "x")
    val base = C.Text.copy(alpha = 0.07f)
    val shine = C.Text.copy(alpha = 0.16f)
    return drawBehind {
        val w = size.width.coerceAtLeast(1f)
        drawRect(Brush.linearGradient(listOf(base, shine, base), start = Offset(w * x - w * 0.6f, 0f), end = Offset(w * x, size.height)))
    }
}

@Composable
private fun RowSkeleton(wide: Boolean, edge: Dp, top: Dp) {
    Column(Modifier.padding(top = top)) {
        Box(Modifier.padding(start = edge + 2.dp).width(if (wide) 220.dp else 160.dp).height(18.dp).clip(RoundedCornerShape(6.dp)).shimmer())
        Row(Modifier.padding(start = edge + 2.dp, top = 12.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(if (wide) 10.dp else 8.dp)) {
            repeat(if (wide) 8 else 4) {
                Box(Modifier.width(if (wide) 154.dp else 112.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).shimmer())
            }
        }
    }
}

/** La pagina com'è fatta, con i riquadri che pulsano: si capisce subito cosa arriva e dove. */
@Composable
private fun DiscoverSkeleton(wide: Boolean, edge: Dp) {
    Column(Modifier.fillMaxSize().clipToBounds()) {
        repeat(3) { RowSkeleton(wide, edge, if (wide) 26.dp else 20.dp) }
    }
}

private fun pct(p: Pair<Long, Long>?): String {
    val (read, total) = p ?: return "…"
    return if (total > 0) " · ${(read * 100 / total).coerceIn(0, 100)}%" else String.format(java.util.Locale.ITALY, " · %.1f MB", read / 1_048_576.0)
}

/** Cosa si sta caricando, sempre in vista in alto: una linea che scorre sul bordo e un'etichetta. Niente se non carica nulla. */
@Composable
private fun BoxScope.LoadingBadge(vm: AppViewModel, extra: String?) {
    val text = when {
        vm.moviesLoading && vm.movies == null -> "Carico i film" + pct(vm.moviesProgress)
        vm.seriesLoading && vm.series == null -> "Carico le serie" + pct(vm.seriesProgress)
        vm.catalogUpdating > 0 || vm.moviesLoading || vm.seriesLoading -> "Cerco titoli nuovi…"
        else -> extra
    }
    // L'ultima etichetta resta mentre il riquadro sparisce.
    var shown by remember { mutableStateOf("") }
    androidx.compose.runtime.SideEffect { if (text != null) shown = text }
    AnimatedVisibility(text != null, Modifier.align(Alignment.TopCenter), enter = fadeIn(), exit = fadeOut()) {
        // In alto a destra: non copre i titoli delle righe.
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            LinearProgressIndicator(Modifier.fillMaxWidth().height(3.dp), color = C.Accent, trackColor = Color.Transparent)
            Row(
                Modifier.padding(top = 10.dp, end = 20.dp).clip(RoundedCornerShape(50)).background(Color(0xD9000000)).padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                Text(text ?: shown, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

// ---------- La mia lista ----------

/** Con la chiave TMDB: film e serie aggiunti con +, in una pagina tutta loro e nell'ordine in cui li hai aggiunti. */
@Composable
fun MyListSection(vm: AppViewModel) {
    val wide = LocalWide.current
    val movies = vm.movies
    val series = vm.series
    if (movies == null && series == null) {
        if (vm.moviesLoading) DownloadProgress("Caricamento film…", vm.moviesProgress) else Loading("Caricamento della tua lista…")
        return
    }
    val list = remember(movies, series, vm.positionsVersion) {
        val order = vm.positions.myList().withIndex().associate { it.value to it.index }
        (vm.moviesFor(MYLIST_ID).map { it.title() } + vm.seriesFor(MYLIST_ID).map { it.title() })
            .sortedBy { t -> order[t.key] ?: Int.MAX_VALUE }
    }
    var remove by remember { mutableStateOf<Title?>(null) }
    Column(Modifier.fillMaxSize()) {
        Text("La mia lista", color = C.Text, fontSize = if (wide) 28.sp else 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(start = 2.dp))
        Text(if (list.size == 1) "1 titolo" else "${list.size} titoli", color = C.Text2, fontSize = 14.sp, modifier = Modifier.padding(start = 2.dp, top = 2.dp, bottom = 8.dp))
        if (list.isEmpty()) Empty("La lista è vuota: aggiungi film e serie con + dalla loro scheda.")
        else LazyVerticalGrid(
            GridCells.Adaptive(if (wide) 160.dp else 116.dp), Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 2.dp, end = 2.dp, top = 10.dp, bottom = 30.dp),
            horizontalArrangement = Arrangement.spacedBy(if (wide) 10.dp else 8.dp),
            verticalArrangement = Arrangement.spacedBy(if (wide) 18.dp else 14.dp),
        ) {
            gridItems(list, key = { it.key }) { t -> PosterTile(vm, t, null, lookup = true, caption = true) { remove = t } }
        }
    }
    remove?.let { t ->
        RemoveContinueDialog(t.name, true, { remove = null }) {
            remove = null
            if (t.movie != null) vm.toggleMyList(t.movie.item) else vm.toggleMyList(t.show!!.item)
        }
    }
}
