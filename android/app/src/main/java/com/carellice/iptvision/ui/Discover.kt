package com.carellice.iptvision.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
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

/** Dove si era quando si è aperto un titolo o una categoria, per tornare allo stesso punto. */
private object Saved { var filter = Filter.All; var index = 0; var offset = 0 }

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
    val movies = vm.movies
    val series = vm.series
    if (movies == null || series == null) {
        if (vm.moviesLoading && movies == null) DownloadProgress("Caricamento film…", vm.moviesProgress)
        else if (vm.seriesLoading && series == null) DownloadProgress("Caricamento serie…", vm.seriesProgress)
        else Loading("Caricamento film e serie…")
        return
    }
    var filter by remember { mutableStateOf(Saved.filter) }
    fun pass(t: Title) = filter == Filter.All || (filter == Filter.Movie) == t.isMovie
    var categories by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<Pair<Title, Boolean>?>(null) } // titolo, dalla mia lista

    // Le liste di TMDB diventano titoli del catalogo, ognuno una volta per riga (lavoro pesante: fuori dal thread della UI).
    val rows = vm.tmdbRows
    val matched by produceState<List<Pair<Tmdb.Row, List<Title>>>?>(null, movies, series, rows) {
        if (rows == null) { value = null; return@produceState }
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
    val hero = remember(matched, filter) {
        matched?.firstOrNull { it.first.id == "trend" }?.second.orEmpty().filter { pass(it) && it.tmdb?.backdrop != null }.take(6)
    }
    val tmdbRows = remember(matched, filter) {
        matched.orEmpty().map { (r, ts) -> r to ts.filter(::pass) }.filter { (r, ts) -> ts.size >= if (r.top) 5 else 4 }
    }
    val providerRows = buildList {
        if (filter != Filter.Tv) movies.categories.forEach { add(Triple(true, it.id, it.name)) }
        if (filter != Filter.Movie) series.categories.forEach { add(Triple(false, it.id, it.name)) }
    }

    val state = rememberLazyListState(Saved.index, Saved.offset)
    DisposableEffect(Unit) { onDispose { Saved.index = state.firstVisibleItemIndex; Saved.offset = state.firstVisibleItemScrollOffset } }
    val gap = if (wide) 26.dp else 20.dp

    LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 30.dp)) {
        item("chips") {
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(2.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                item { Pill("Tutto", filter == Filter.All) { filter = Filter.All; Saved.filter = filter } }
                item { Pill("Film", filter == Filter.Movie) { filter = Filter.Movie; Saved.filter = filter } }
                item { Pill("Serie TV", filter == Filter.Tv) { filter = Filter.Tv; Saved.filter = filter } }
                item { Pill("Categorie", false, Icons.Default.KeyboardArrowDown) { categories = true } }
            }
        }
        vm.tmdbError?.let { e ->
            item("error") { Text("$e Controlla la chiave in Impostazioni → TMDB.", color = C.Danger, fontSize = 14.sp, modifier = Modifier.padding(start = 2.dp, bottom = 12.dp)) }
        }
        if (matched == null && vm.tmdbError == null) item("placeholder") {
            Box(Modifier.fillMaxWidth().height(if (wide) 420.dp else 460.dp).clip(RoundedCornerShape(16.dp)).background(C.Surface))
        }
        if (hero.isNotEmpty()) item("hero") { Hero(vm, hero, wide) }

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
        tmdbRows.forEachIndexed { i, (r, ts) ->
            item(r.id) {
                DRow(if (r.top) "${r.title} in Italia" else r.title, gap) {
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
            Text("Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista.", color = C.Text2, fontSize = 14.sp, modifier = Modifier.padding(top = 20.dp, start = 2.dp))
        }
        item("cats") {
            Text("Le categorie della lista", color = C.Text, fontSize = if (wide) 24.sp else 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = if (wide) 44.dp else 32.dp, start = 2.dp))
        }
        // Le righe della LazyColumn si compongono solo quando arrivano vicino allo schermo.
        items(providerRows, key = { (m, id, _) -> "c:$m:$id" }) { (isMovie, id, name) ->
            val titles = remember(id, isMovie, movies, series, vm.positionsVersion) {
                if (isMovie) vm.moviesFor(id).take(30).map { it.title() } else vm.seriesFor(id).take(30).map { it.title() }
            }
            if (titles.isNotEmpty()) DRow(if (isMovie) name else "$name · Serie", gap, onAll = { vm.openCategory(Section.Discover, "${if (isMovie) "m" else "s"}:$id") }) {
                items(titles, key = { it.key }) { t -> PosterTile(vm, t, null, caption = true) }
            }
        }
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

// ---------- In alto ----------

@Composable
private fun Hero(vm: AppViewModel, items: List<Title>, wide: Boolean) {
    var i by remember(items) { mutableIntStateOf(0) }
    LaunchedEffect(items, i) {
        if (items.size < 2) return@LaunchedEffect
        delay(9_000)
        i = (i + 1) % items.size
    }
    val t = items[i % items.size]
    val tm = t.tmdb!!
    @Suppress("UNUSED_VARIABLE") val pv = vm.positionsVersion
    BoxWithConstraints(Modifier.fillMaxWidth().clip(RoundedCornerShape(if (wide) 18.dp else 16.dp)).background(Color.Black)) {
        val h = if (wide) (maxWidth * 0.42f).coerceIn(340.dp, 560.dp) else (maxWidth * 1.32f).coerceAtMost(560.dp)
        Box(Modifier.fillMaxWidth().height(h)) {
            AnimatedContent(t, transitionSpec = { fadeIn(tween(900)) togetherWith fadeOut(tween(900)) }, label = "hero") { x ->
                val p = if (wide) Tmdb.img(x.tmdb?.backdrop, "w1280") else Tmdb.img(x.tmdb?.poster, "w780") ?: Tmdb.img(x.tmdb?.backdrop, "w780")
                AsyncImage(p, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = if (wide) BiasAlignment(0f, -0.5f) else Alignment.TopCenter)
            }
            if (wide) {
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xE0000000), 0.35f to Color(0x8C000000), 0.68f to Color.Transparent)))
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.6f to Color.Transparent, 1f to Color(0xBF000000))))
            } else {
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.38f to Color.Transparent, 0.62f to Color(0x8C000000), 1f to Color(0xF2000000))))
            }
            val listed = if (t.movie != null) vm.inMyList(t.movie.item) else vm.inMyList(t.show!!.item)
            Column(
                Modifier.align(if (wide) Alignment.BottomStart else Alignment.BottomCenter)
                    .padding(start = if (wide) 44.dp else 18.dp, end = if (wide) 0.dp else 18.dp, bottom = if (wide) 46.dp else 22.dp)
                    .then(if (wide) Modifier.fillMaxWidth(0.58f) else Modifier.fillMaxWidth()),
                horizontalAlignment = if (wide) Alignment.Start else Alignment.CenterHorizontally,
            ) {
                Text("N. ${i + 1} DI TENDENZA", color = C.Accent2, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp)
                Text(
                    tm.title.ifEmpty { t.name }, color = Color.White, fontSize = if (wide) 46.sp else 32.sp, lineHeight = if (wide) 52.sp else 38.sp,
                    fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = if (wide) TextAlign.Start else TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp, bottom = 8.dp),
                )
                val meta = listOfNotNull(if (t.isMovie) "Film" else "Serie TV", tm.year, if (tm.vote > 0) "★ " + String.format(java.util.Locale.ITALY, "%.1f", tm.vote) else null).joinToString("  ·  ")
                Text(meta, color = Color(0xCCFFFFFF), fontSize = 14.sp, fontWeight = FontWeight.Medium)
                if (wide && tm.overview.isNotEmpty()) Text(tm.overview, color = Color(0xE0FFFFFF), fontSize = 15.sp, lineHeight = 22.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp).widthIn(max = 560.dp))
                Row(Modifier.padding(top = if (wide) 20.dp else 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HeroButton(if (t.isMovie) "Riproduci" else "Episodi", Icons.Default.PlayArrow, primary = true) { vm.playTitle(t) }
                    HeroButton("Altre info", Icons.Default.Info) { vm.openTitle(t) }
                    HeroButton(null, if (listed) Icons.Default.Check else Icons.Default.Add) {
                        if (t.movie != null) vm.toggleMyList(t.movie.item) else vm.toggleMyList(t.show!!.item)
                    }
                }
            }
            if (items.size > 1) Row(
                Modifier.align(if (wide) Alignment.BottomEnd else Alignment.BottomCenter).padding(end = if (wide) 28.dp else 0.dp, bottom = if (wide) 24.dp else 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items.indices.forEach { n ->
                    val w by animateDpAsState(if (n == i) 22.dp else 7.dp, tween(300), label = "dot")
                    Box(Modifier.width(w).height(7.dp).clip(RoundedCornerShape(4.dp)).background(if (n == i) Color.White else Color(0x66FFFFFF)))
                }
            }
        }
    }
}

@Composable
private fun HeroButton(text: String?, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean = false, onClick: () -> Unit) {
    val shape = if (text != null) RoundedCornerShape(8.dp) else CircleShape
    Row(
        Modifier
            .tvClickable(shape = shape, background = if (primary) Color.White else Color(0x8C6E6E73), focusedBackground = if (primary) Color(0xFFDDDDDD) else Color(0xB36E6E73), onClick = onClick)
            .then(if (text == null) Modifier.border(1.5.dp, Color(0x99FFFFFF), shape) else Modifier)
            .padding(if (text != null) PaddingValues(start = 14.dp, end = 20.dp, top = 9.dp, bottom = 9.dp) else PaddingValues(9.dp)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = if (primary) Color.Black else Color.White, modifier = Modifier.size(24.dp))
        if (text != null) Text(text, color = if (primary) Color.Black else Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
    }
}

// ---------- Le righe ----------

@Composable
private fun DRow(title: String, top: androidx.compose.ui.unit.Dp, onAll: (() -> Unit)? = null, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    val wide = LocalWide.current
    Column(Modifier.padding(top = top)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 2.dp)) {
            Text(title, color = C.Text, fontSize = if (wide) 20.sp else 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (onAll != null) Text(
                "Vedi tutto ›", color = C.Accent2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                modifier = Modifier.padding(start = 10.dp).tvClickable(shape = RoundedCornerShape(6.dp), background = Color.Transparent, onClick = onAll).padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
        // Spazio attorno per il riquadro che si ingrandisce quando ha il focus.
        LazyRow(horizontalArrangement = Arrangement.spacedBy(if (wide) 10.dp else 8.dp), contentPadding = PaddingValues(horizontal = 2.dp, vertical = 10.dp), content = content)
    }
}

@Composable
private fun PosterTile(vm: AppViewModel, t: Title, known: Tmdb.Card?, lookup: Boolean = false, caption: Boolean = false, onLong: (() -> Unit)? = null) {
    val wide = LocalWide.current
    val tm = rememberTmdb(vm, t.kind, t.name, t.year, known, lookup)
    val p = vm.progressOf(t)
    Column(Modifier.width(if (wide) 154.dp else 112.dp).tvClickable(shape = RoundedCornerShape(8.dp), focusScale = 1.08f, background = Color.Transparent, focusedBackground = Color.Transparent, onLongClick = onLong) { vm.openTitle(t) }) {
        Box {
            Artwork(Tmdb.img(tm?.poster) ?: t.poster, t.initials, Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(skinCorners(8.dp)), fontSize = 20)
            if (p > 0f && p < 1f) ProgressLine(p, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp))
            if (!t.isMovie && !caption) KindBadge()
        }
        if (caption) Text(t.name, color = C.Text2, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
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
    Row(
        Modifier.height(h).tvClickable(shape = RoundedCornerShape(8.dp), background = Color.Transparent, focusedBackground = Color.Transparent) { vm.openTitle(t) }.padding(end = 4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        // Il numero grande col solo contorno, mezzo nascosto dietro la locandina.
        Text(
            "$n", color = C.Text3, fontSize = (h.value * 0.95f).sp, lineHeight = (h.value * 0.8f).sp, fontWeight = FontWeight.Black,
            letterSpacing = if (n == 10) (-h.value * 0.12f).sp else 0.sp,
            style = TextStyle(drawStyle = Stroke(width = 6f)),
            modifier = Modifier.offset(x = h * 0.12f),
        )
        Artwork(Tmdb.img(t.tmdb?.poster) ?: t.poster, t.initials, Modifier.fillMaxHeight().aspectRatio(2f / 3f).clip(skinCorners(8.dp)), fontSize = 18)
    }
}

/** Continua a guardare: la scena del titolo con l'avanzamento, come fanno i servizi di streaming. */
@Composable
private fun WideTile(vm: AppViewModel, t: Title, known: Tmdb.Card?, onLong: () -> Unit) {
    val wide = LocalWide.current
    val tm = rememberTmdb(vm, t.kind, t.name, t.year, known)
    val p = vm.progressOf(t)
    Column(Modifier.width(if (wide) 290.dp else 220.dp).tvClickable(shape = RoundedCornerShape(8.dp), background = Color.Transparent, focusedBackground = Color.Transparent, onLongClick = onLong) { vm.playTitle(t) }) {
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
    if (lib == null) { Loading("Caricamento…"); return }
    val name = if (catId == ALL_ID) (if (isMovie) "Tutti i film" else "Tutte le serie") else lib.categories.firstOrNull { it.id == catId }?.name ?: ""
    val section = if (isMovie) Section.Movies else Section.Series
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
            if (!vm.isTv) Box(Modifier.tvClickable(shape = CircleShape, background = Color.Transparent) { vm.closeCategory(Section.Discover) }.padding(10.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro", tint = C.Text)
            }
            Column(Modifier.weight(1f).padding(start = 6.dp)) {
                Text(name, color = C.Text, fontSize = if (wide) 24.sp else 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
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
