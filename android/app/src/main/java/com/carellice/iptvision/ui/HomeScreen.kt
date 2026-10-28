package com.carellice.iptvision.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.ViewModule
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.ALL_ID
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.CONTINUE_ID
import com.carellice.iptvision.FAVORITES_ID
import com.carellice.iptvision.R
import com.carellice.iptvision.Section
import com.carellice.iptvision.data.Category
import com.carellice.iptvision.data.Channel
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun Section.icon(): ImageVector = when (this) {
    Section.Live -> Icons.Default.Tv
    Section.Movies -> Icons.Default.Movie
    Section.Series -> Icons.Default.ViewModule
    Section.Search -> Icons.Default.Search
    Section.Settings -> Icons.Default.Settings
}

/** Larghezza da tablet/TV: categorie a sinistra e menu laterale; sotto, layout da telefono. */
val LocalWide = androidx.compose.runtime.compositionLocalOf { false }

@Composable
fun HomeScreen(vm: AppViewModel, onVoiceSearch: () -> Unit) {
    LaunchedEffect(vm.section) {
        if (vm.section == Section.Movies) vm.ensureMovies()
        if (vm.section == Section.Series) vm.ensureSeries()
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(C.Bg)) {
        val wide = maxWidth >= 720.dp
        androidx.compose.runtime.CompositionLocalProvider(LocalWide provides wide) {
            if (wide) {
                Row(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    SideNav(vm)
                    Column(Modifier.weight(1f).fillMaxHeight().padding(start = 8.dp, end = 24.dp, top = 20.dp)) {
                        Content(vm, onVoiceSearch)
                    }
                }
            } else {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp).padding(top = 12.dp)) { Content(vm, onVoiceSearch) }
                    NavigationBar(containerColor = C.Panel) {
                        Section.entries.forEach { s ->
                            NavigationBarItem(
                                selected = vm.section == s,
                                onClick = { vm.section = s },
                                icon = { Icon(s.icon(), null) },
                                label = { Text(if (s == Section.Live) "TV" else if (s == Section.Settings) "Altro" else s.title, fontSize = 11.sp) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Color.White, indicatorColor = C.Accent,
                                    unselectedIconColor = C.Text2, unselectedTextColor = C.Text2, selectedTextColor = C.Text,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Content(vm: AppViewModel, onVoiceSearch: () -> Unit) {
    vm.status?.let { Text(it, color = C.Text2, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp)) }
    when (vm.section) {
        Section.Live -> LiveSection(vm)
        Section.Movies -> MoviesSection(vm)
        Section.Series -> SeriesSection(vm)
        Section.Search -> SearchSection(vm, onVoiceSearch)
        Section.Settings -> SettingsSection(vm)
    }
}

@Composable
private fun SideNav(vm: AppViewModel) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (vm.isTv) runCatching { first.requestFocus() } }
    Column(
        Modifier.width(220.dp).fillMaxHeight().background(C.Panel).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 6.dp, top = 8.dp, bottom = 18.dp)) {
            Image(painterResource(R.drawable.logo), null, Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)))
            HSpace(10.dp)
            Text("IPTVISION", color = C.Text, fontWeight = FontWeight.Bold, fontSize = 19.sp)
        }
        Section.entries.forEach { s ->
            val selected = vm.section == s
            Row(
                Modifier.fillMaxWidth()
                    .then(if (selected) Modifier.focusRequester(first) else Modifier)
                    .tvClickable(
                        focusScale = 1.02f,
                        background = if (selected) C.AccentSoft else Color.Transparent,
                        focusedBackground = C.SurfacePressed,
                        // Col telecomando basta spostarsi sulla voce per aprire la sezione.
                        onFocus = { if (vm.isTv) vm.section = s },
                    ) { vm.section = s }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(s.icon(), null, tint = if (selected) C.Accent else C.Text2, modifier = Modifier.size(22.dp))
                HSpace(12.dp)
                Text(s.title, color = if (selected) C.Text else C.Text2, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
        Box(Modifier.weight(1f))
        Clock()
    }
}

@Composable
fun Clock() {
    val now by produceState(System.currentTimeMillis()) {
        while (true) { value = System.currentTimeMillis(); delay(15_000) }
    }
    Column(Modifier.padding(6.dp)) {
        Text(SimpleDateFormat("HH:mm", Locale.ITALY).format(Date(now)), color = C.Text, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(SimpleDateFormat("EEEE d MMMM", Locale.ITALY).format(Date(now)).replaceFirstChar { it.uppercase() }, color = C.Text2, fontSize = 12.sp)
    }
}

// ---------- Categorie ----------

data class CatEntry(val id: String, val name: String, val count: Int, val icon: ImageVector)

@Composable
private fun CategoryPane(entries: List<CatEntry>, selected: String, onSelect: (String) -> Unit, content: @Composable () -> Unit) {
    val wide = LocalWide.current
    if (wide) {
        Row(Modifier.fillMaxSize()) {
            val state = rememberLazyListState(initialFirstVisibleItemIndex = entries.indexOfFirst { it.id == selected }.coerceAtLeast(0))
            LazyColumn(
                state = state,
                modifier = Modifier.width(250.dp).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp),
            ) {
                items(entries, key = { it.id }) { c ->
                    val sel = c.id == selected
                    Row(
                        Modifier.fillMaxWidth()
                            .tvClickable(
                                focusScale = 1.02f, shape = RoundedCornerShape(10.dp),
                                background = if (sel) C.AccentSoft else Color.Transparent,
                                focusedBackground = C.SurfacePressed,
                            ) { onSelect(c.id) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(c.icon, null, tint = if (sel) C.Accent else C.Text3, modifier = Modifier.size(18.dp))
                        HSpace(10.dp)
                        Text(c.name, color = if (sel) C.Text else C.Text2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(c.count.toString(), color = C.Text3, fontSize = 12.sp)
                    }
                }
            }
            HSpace(16.dp)
            Box(Modifier.weight(1f).fillMaxHeight()) { content() }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            val state = rememberLazyListState(initialFirstVisibleItemIndex = entries.indexOfFirst { it.id == selected }.coerceAtLeast(0))
            LazyRow(state = state, horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 6.dp)) {
                items(entries, key = { it.id }) { c -> Pill("${c.name}  ${c.count}", c.id == selected) { onSelect(c.id) } }
            }
            VSpace(6.dp)
            Box(Modifier.weight(1f)) { content() }
        }
    }
}

private fun cats(categories: List<Category>, counts: (String) -> Int, extra: List<CatEntry>): List<CatEntry> =
    extra + categories.map { CatEntry(it.id, it.name, counts(it.id), Icons.Default.Folder) }

// ---------- TV in diretta ----------

@Composable
private fun LiveSection(vm: AppViewModel) {
    val lib = vm.live
    if (lib == null) { if (vm.error != null) Empty(vm.error!!) else Loading("Caricamento canali…"); return }
    val entries = remember(lib, vm.favorites) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, listOf(
            CatEntry(FAVORITES_ID, "Preferiti", lib.items.count { it.streamId in vm.favorites }, Icons.Default.Star),
            CatEntry(ALL_ID, "Tutti", lib.items.size, Icons.Default.Apps),
        ))
    }
    val catId = vm.liveCategory.takeIf { id -> entries.any { it.id == id } } ?: ALL_ID
    CategoryPane(entries, catId, vm::selectLiveCategory) {
        val list = remember(lib, catId, vm.favorites) { vm.channelsFor(catId) }
        if (list.isEmpty()) {
            Empty(if (catId == FAVORITES_ID) "Nessun preferito. Tieni premuto un canale (o premi Menu sul telecomando) per aggiungerlo." else "Nessun canale.")
        } else {
            val playingId = (vm.playing as? com.carellice.iptvision.Playing.Live)?.channel?.streamId ?: vm.settings.lastStreamId
            val state = rememberLazyListState(initialFirstVisibleItemIndex = list.indexOfFirst { it.streamId == playingId }.coerceAtLeast(0))
            LazyColumn(state = state, verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp)) {
                items(list, key = { it.streamId }) { ch -> ChannelRow(vm, ch, list, ch.streamId == playingId) }
            }
        }
    }
}

@Composable
fun ChannelRow(vm: AppViewModel, ch: Channel, playlist: List<Channel>, current: Boolean) {
    @Suppress("UNUSED_VARIABLE") val tick = vm.epgVersion
    val (now, next) = vm.epg.nowNext(ch)
    val fav = ch.streamId in vm.favorites
    Row(
        Modifier.fillMaxWidth()
            .tvClickable(focusScale = 1.02f, onLongClick = { vm.toggleFavorite(ch) }) { vm.playChannel(ch, playlist) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(ch.logo, ch.initials, Modifier.size(width = 72.dp, height = 48.dp).clip(RoundedCornerShape(8.dp)), androidx.compose.ui.layout.ContentScale.Fit, 15)
        HSpace(12.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (ch.num > 0) { Text("${ch.num}", color = C.Text3, fontSize = 13.sp); HSpace(8.dp) }
                Text(ch.name, color = if (current) C.Accent2 else C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (now != null) {
                Text(now.title, color = C.Text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                VSpace(4.dp)
                ProgressLine(now.progressAt(System.currentTimeMillis() / 1000), Modifier.fillMaxWidth(0.6f))
            } else if (next != null) {
                Text("Alle ${next.timeRange.substringBefore(' ')}: ${next.title}", color = C.Text3, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (vm.isTv) {
            if (fav) Icon(Icons.Default.Star, null, tint = C.Star, modifier = Modifier.size(20.dp))
        } else {
            IconButton(onClick = { vm.toggleFavorite(ch) }) {
                Icon(if (fav) Icons.Default.Star else Icons.Default.StarBorder, "Preferito", tint = if (fav) C.Star else C.Text3)
            }
        }
    }
}

// ---------- Film e serie ----------

@Composable
private fun MoviesSection(vm: AppViewModel) {
    val lib = vm.movies
    if (lib == null) { Loading(if (vm.moviesLoading) "Caricamento film…" else null); return }
    @Suppress("UNUSED_VARIABLE") val pv = vm.positionsVersion
    val cont = remember(lib, vm.positionsVersion) { vm.moviesFor(CONTINUE_ID) }
    val entries = remember(lib, cont.size) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, buildList {
            if (cont.isNotEmpty()) add(CatEntry(CONTINUE_ID, "Continua a guardare", cont.size, Icons.Default.History))
            add(CatEntry(ALL_ID, "Tutti", lib.items.size, Icons.Default.Apps))
        })
    }
    val catId = vm.movieCategory.takeIf { id -> entries.any { it.id == id } } ?: ALL_ID
    CategoryPane(entries, catId, { vm.movieCategory = it }) {
        val list = remember(lib, catId, vm.positionsVersion) { vm.moviesFor(catId) }
        PosterGrid(list, key = { it.streamId }) { m ->
            Poster(m.name, m.meta, m.poster, m.initials, vm.positions.progress(m.key)) { vm.openMovie(m) }
        }
    }
}

@Composable
private fun SeriesSection(vm: AppViewModel) {
    val lib = vm.series
    if (lib == null) { Loading(if (vm.seriesLoading) "Caricamento serie…" else null); return }
    val cont = remember(lib, vm.positionsVersion) { vm.seriesFor(CONTINUE_ID) }
    val entries = remember(lib, cont.size) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, buildList {
            if (cont.isNotEmpty()) add(CatEntry(CONTINUE_ID, "Continua a guardare", cont.size, Icons.Default.History))
            add(CatEntry(ALL_ID, "Tutte", lib.items.size, Icons.Default.Apps))
        })
    }
    val catId = vm.seriesCategory.takeIf { id -> entries.any { it.id == id } } ?: ALL_ID
    CategoryPane(entries, catId, { vm.seriesCategory = it }) {
        val list = remember(lib, catId, vm.positionsVersion) { vm.seriesFor(catId) }
        PosterGrid(list, key = { it.seriesId }) { s ->
            Poster(s.name, s.meta, s.cover, s.initials, 0f) { vm.openSeries(s) }
        }
    }
}

@Composable
fun <T> PosterGrid(list: List<T>, key: (T) -> Any, item: @Composable (T) -> Unit) {
    if (list.isEmpty()) { Empty("Nessun contenuto."); return }
    val wide = LocalWide.current
    LazyVerticalGrid(
        columns = GridCells.Adaptive(if (wide) 150.dp else 110.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        // Spazio attorno per il riquadro che si ingrandisce quando ha il focus.
        contentPadding = PaddingValues(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(list, key = key) { item(it) }
    }
}

@Composable
fun Poster(title: String, meta: String, url: String?, initials: String, progress: Float, onClick: () -> Unit) {
    Column(Modifier.tvClickable(focusScale = 1.06f, background = Color.Transparent, focusedBackground = C.Surface, onClick = onClick).padding(4.dp)) {
        Box {
            Artwork(url, initials, Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp)), fontSize = 22)
            if (progress > 0f && progress < 1f) ProgressLine(progress, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp))
            if (progress >= 1f) Box(Modifier.align(Alignment.TopEnd).padding(6.dp)) { Badge("Visto", C.Accent) }
        }
        VSpace(6.dp)
        Text(title, color = C.Text, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (meta.isNotEmpty()) Text(meta, color = C.Text3, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.height(2.dp))
    }
}
