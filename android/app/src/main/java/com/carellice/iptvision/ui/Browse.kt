package com.carellice.iptvision.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.ALL_ID
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.CONTINUE_ID
import com.carellice.iptvision.FAVORITES_ID
import com.carellice.iptvision.ListSort
import com.carellice.iptvision.Playing
import com.carellice.iptvision.Section
import com.carellice.iptvision.data.Category
import com.carellice.iptvision.data.Channel
import com.carellice.iptvision.data.Entry
import com.carellice.iptvision.data.Movie
import com.carellice.iptvision.data.Series
import kotlinx.coroutines.delay

data class CatEntry(val id: String, val name: String, val count: Int, val icon: ImageVector)

private fun cats(categories: List<Category>, counts: (String) -> Int, extra: List<CatEntry>): List<CatEntry> =
    extra + categories.map { CatEntry(it.id, it.name, counts(it.id), Icons.Default.Folder) }

/** Il riquadro da cui riprendere il focus col telecomando (categoria appena chiusa, canale in onda…). */
@Composable
private fun Modifier.initialFocus(enabled: Boolean, tv: Boolean): Modifier {
    if (!enabled || !tv) return this
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(80); runCatching { fr.requestFocus() } }
    return focusRequester(fr)
}

/**
 * Una sezione del catalogo: prima l'elenco delle categorie; scelta la categoria,
 * il suo contenuto con ordinamento ed elenco/griglia.
 */
@Composable
private fun LibrarySection(
    vm: AppViewModel,
    section: Section,
    entries: List<CatEntry>,
    unit: (Int) -> String,
    count: (catId: String) -> Int,
    content: @Composable (catId: String, grid: Boolean) -> Unit,
) {
    val open = vm.openCategory(section)
    val entry = entries.firstOrNull { it.id == open }
    if (open == null || entry == null) {
        CategoryBrowser(vm, section, entries)
        return
    }
    Column(Modifier.fillMaxSize()) {
        // Il numero conta i titoli come compaiono: le versioni dello stesso film valgono uno.
        val n = remember(open, vm.sortOf(section), vm.positionsVersion, vm.favorites, vm.live, vm.movies, vm.series) { count(open) }
        ListHeader(vm, section, entry.name, unit(n))
        Box(Modifier.weight(1f)) { content(open, vm.isGrid(section)) }
    }
}

@Composable
private fun CategoryBrowser(vm: AppViewModel, section: Section, entries: List<CatEntry>) {
    val wide = LocalWide.current
    val last = vm.lastCategory[section]
    val lastIndex = entries.indexOfFirst { it.id == last }.coerceAtLeast(0)
    Column(Modifier.fillMaxSize()) {
        SectionTitle(section.title, if (entries.size == 1) "1 categoria" else "${entries.size} categorie", Modifier.padding(start = 4.dp, bottom = 10.dp))
        if (wide) {
            LazyVerticalGrid(
                state = rememberLazyGridState(initialFirstVisibleItemIndex = lastIndex),
                columns = GridCells.Adaptive(200.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(entries, key = { _, c -> c.id }) { i, c ->
                    Column(
                        Modifier.fillMaxWidth().height(96.dp)
                            .initialFocus(last != null && i == lastIndex, vm.isTv)
                            .tvClickable { vm.openCategory(section, c.id) }
                            .padding(14.dp),
                        verticalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(c.icon, null, tint = catTint(c.id), modifier = Modifier.size(20.dp))
                            Box(Modifier.weight(1f))
                            Text(c.count.toString(), color = C.Text3, fontSize = 13.sp)
                        }
                        Text(c.name, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        } else {
            LazyColumn(
                state = rememberLazyListState(initialFirstVisibleItemIndex = lastIndex),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(vertical = 4.dp, horizontal = 2.dp),
            ) {
                itemsIndexed(entries, key = { _, c -> c.id }) { _, c ->
                    Row(
                        Modifier.fillMaxWidth().tvClickable(focusScale = 1.02f) { vm.openCategory(section, c.id) }.padding(horizontal = 14.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(c.icon, null, tint = catTint(c.id), modifier = Modifier.size(20.dp))
                        HSpace(14.dp)
                        Text(c.name, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(c.count.toString(), color = C.Text3, fontSize = 13.sp)
                        HSpace(6.dp)
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = C.Text3, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}

private fun catTint(id: String) = when (id) {
    FAVORITES_ID -> C.Star
    CONTINUE_ID -> C.Accent
    else -> C.Text2
}

/** Intestazione della categoria aperta: indietro, nome, ordinamento ed elenco/griglia. */
@Composable
private fun ListHeader(vm: AppViewModel, section: Section, title: String, count: String) {
    val wide = LocalWide.current
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.tvClickable(shape = RoundedCornerShape(50), background = Color.Transparent) { vm.closeCategory(section) }.padding(10.dp)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Categorie", tint = C.Text)
        }
        HSpace(6.dp)
        Column(Modifier.weight(1f)) {
            Text(title, color = C.Text, fontSize = if (wide) 24.sp else 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(count, color = C.Text2, fontSize = 12.sp)
        }
        SortButton(vm, section, compact = !wide)
        HSpace(8.dp)
        ViewToggle(vm, section)
    }
}

@Composable
private fun SortButton(vm: AppViewModel, section: Section, compact: Boolean) {
    var open by remember { mutableStateOf(false) }
    val current = vm.sortOf(section)
    Box {
        Row(
            Modifier.tvClickable(shape = RoundedCornerShape(10.dp)) { open = true }.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Sort, "Ordina", tint = C.Text2, modifier = Modifier.size(18.dp))
            if (!compact) { HSpace(8.dp); Text(current.label, color = C.Text, fontSize = 13.sp, maxLines = 1) }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = C.Panel) {
            Text("Ordina per", color = C.Text3, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            ListSort.optionsFor(section).forEach { s ->
                DropdownMenuItem(
                    text = { Text(s.label, color = if (s == current) C.Accent2 else C.Text) },
                    leadingIcon = { if (s == current) Icon(Icons.Default.Check, null, tint = C.Accent2) else Box(Modifier.size(24.dp)) },
                    onClick = { vm.setSort(section, s); open = false },
                    colors = MenuDefaults.itemColors(),
                )
            }
        }
    }
}

@Composable
private fun ViewToggle(vm: AppViewModel, section: Section) {
    val grid = vm.isGrid(section)
    Row(Modifier.clip(RoundedCornerShape(10.dp)).padding(1.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(false to Icons.AutoMirrored.Filled.ViewList, true to Icons.Default.GridView).forEach { (g, icon) ->
            val sel = g == grid
            Box(
                Modifier.tvClickable(shape = RoundedCornerShape(10.dp), background = if (sel) C.AccentSoft else C.Surface) { vm.setGrid(section, g) }
                    .padding(9.dp),
            ) { Icon(icon, if (g) "Griglia" else "Elenco", tint = if (sel) C.Accent else C.Text2, modifier = Modifier.size(20.dp)) }
        }
    }
}

// ---------- TV in diretta ----------

@Composable
fun LiveSection(vm: AppViewModel) {
    val lib = vm.live
    if (lib == null) { if (vm.error != null) Empty(vm.error!!) else Loading("Caricamento canali…"); return }
    val entries = remember(lib, vm.favorites) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, listOf(
            CatEntry(FAVORITES_ID, "Preferiti", lib.items.count { it.streamId in vm.favorites }, Icons.Default.Star),
            CatEntry(ALL_ID, "Tutti", lib.items.size, Icons.Default.Apps),
        ))
    }
    LibrarySection(vm, Section.Live, entries, { if (it == 1) "1 canale" else "$it canali" }, { vm.channelsFor(it).size }) { catId, grid ->
        val list = remember(lib, catId, vm.favorites, vm.sortOf(Section.Live)) { vm.channelsFor(catId) }
        if (list.isEmpty()) {
            Empty(if (catId == FAVORITES_ID) "Nessun preferito. Tieni premuto un canale (o premi Menu sul telecomando) per aggiungerlo." else "Nessun canale.")
            return@LibrarySection
        }
        val playingId = (vm.playing as? Playing.Live)?.channel?.streamId ?: vm.settings.lastStreamId
        val start = list.indexOfFirst { it.streamId == playingId }.coerceAtLeast(0)
        if (grid) {
            LazyVerticalGrid(
                state = rememberLazyGridState(initialFirstVisibleItemIndex = start),
                columns = GridCells.Adaptive(if (LocalWide.current) 170.dp else 108.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(list, key = { _, c -> c.streamId }) { i, ch ->
                    ChannelTile(vm, ch, list, ch.streamId == playingId, Modifier.initialFocus(i == start, vm.isTv))
                }
            }
        } else {
            LazyColumn(
                state = rememberLazyListState(initialFirstVisibleItemIndex = start),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp),
            ) {
                itemsIndexed(list, key = { _, c -> c.streamId }) { i, ch ->
                    ChannelRow(vm, ch, list, ch.streamId == playingId, Modifier.initialFocus(i == start, vm.isTv))
                }
            }
        }
    }
}

@Composable
fun ChannelRow(vm: AppViewModel, ch: Channel, playlist: List<Channel>, current: Boolean, modifier: Modifier = Modifier) {
    @Suppress("UNUSED_VARIABLE") val tick = vm.epgVersion
    val (now, next) = vm.epg.nowNext(ch)
    val fav = ch.streamId in vm.favorites
    Row(
        modifier.fillMaxWidth()
            .tvClickable(focusScale = 1.02f, onLongClick = { vm.toggleFavorite(ch) }) { vm.playChannel(ch, playlist) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(ch.logo, ch.initials, Modifier.size(width = 72.dp, height = 48.dp).clip(RoundedCornerShape(8.dp)), ContentScale.Fit, 15)
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

@Composable
private fun ChannelTile(vm: AppViewModel, ch: Channel, playlist: List<Channel>, current: Boolean, modifier: Modifier) {
    @Suppress("UNUSED_VARIABLE") val tick = vm.epgVersion
    val now = vm.epg.nowNext(ch).first
    Column(
        modifier.tvClickable(
            focusScale = 1.06f,
            background = if (current) C.AccentSoft else C.Surface,
            onLongClick = { vm.toggleFavorite(ch) },
        ) { vm.playChannel(ch, playlist) }.padding(8.dp),
    ) {
        Box {
            Artwork(ch.logo, ch.initials, Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(RoundedCornerShape(8.dp)), ContentScale.Fit, 18)
            if (ch.streamId in vm.favorites) Icon(Icons.Default.Star, null, tint = C.Star, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(16.dp))
        }
        VSpace(6.dp)
        Text((if (ch.num > 0) "${ch.num}  " else "") + ch.name, color = if (current) C.Accent2 else C.Text, fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(now?.title ?: " ", color = C.Text3, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (now != null) { VSpace(4.dp); ProgressLine(now.progressAt(System.currentTimeMillis() / 1000), Modifier.fillMaxWidth()) }
    }
}

// ---------- Film e serie ----------

@Composable
fun MoviesSection(vm: AppViewModel) {
    val lib = vm.movies
    if (lib == null) { Loading(if (vm.moviesLoading) "Caricamento film…" else null); return }
    val cont = remember(lib, vm.positionsVersion) { vm.moviesFor(CONTINUE_ID) }
    val entries = remember(lib, cont.size) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, buildList {
            if (cont.isNotEmpty()) add(CatEntry(CONTINUE_ID, "Continua a guardare", cont.size, Icons.Default.History))
            add(CatEntry(ALL_ID, "Tutti", lib.items.size, Icons.Default.Apps))
        })
    }
    LibrarySection(vm, Section.Movies, entries, { if (it == 1) "1 film" else "$it film" }, { vm.moviesFor(it).size }) { catId, grid ->
        val list = remember(lib, catId, vm.positionsVersion, vm.sortOf(Section.Movies)) { vm.moviesFor(catId) }
        var remove by remember { mutableStateOf<Entry<Movie>?>(null) }
        EntryList(vm, list, grid, key = { it.streamId }) { e, mod, g ->
            val m = e.item
            // In "Continua a guardare" la pressione lunga (o il tasto Menu) toglie il titolo dall'elenco.
            val long: (() -> Unit)? = if (catId == CONTINUE_ID) ({ remove = e }) else null
            if (g) Poster(m.name, m.meta, m.poster, m.initials, vm.progressOf(e), e.variantsText.takeIf { e.hasVariants }, mod, long) { vm.openMovieEntry(e) }
            else MediaRow(m.name, m.meta, m.poster, m.initials, vm.progressOf(e), e.variantsText.takeIf { e.hasVariants }, mod, long) { vm.openMovieEntry(e) }
        }
        remove?.let { e -> RemoveContinueDialog(e.item.name, { remove = null }) { vm.removeMovieFromContinue(e); remove = null } }
    }
}

@Composable
fun SeriesSection(vm: AppViewModel) {
    val lib = vm.series
    if (lib == null) { Loading(if (vm.seriesLoading) "Caricamento serie…" else null); return }
    val cont = remember(lib, vm.positionsVersion) { vm.seriesFor(CONTINUE_ID) }
    val entries = remember(lib, cont.size) {
        cats(lib.categories, { lib.byCategory[it]?.size ?: 0 }, buildList {
            if (cont.isNotEmpty()) add(CatEntry(CONTINUE_ID, "Continua a guardare", cont.size, Icons.Default.History))
            add(CatEntry(ALL_ID, "Tutte", lib.items.size, Icons.Default.Apps))
        })
    }
    LibrarySection(vm, Section.Series, entries, { if (it == 1) "1 serie" else "$it serie" }, { vm.seriesFor(it).size }) { catId, grid ->
        val list = remember(lib, catId, vm.positionsVersion, vm.sortOf(Section.Series)) { vm.seriesFor(catId) }
        var remove by remember { mutableStateOf<Entry<Series>?>(null) }
        EntryList(vm, list, grid, key = { it.seriesId }) { e, mod, g ->
            val s = e.item
            val long: (() -> Unit)? = if (catId == CONTINUE_ID) ({ remove = e }) else null
            if (g) Poster(s.name, s.meta, s.cover, s.initials, 0f, e.variantsText.takeIf { e.hasVariants }, mod, long) { vm.openSeriesEntry(e) }
            else MediaRow(s.name, s.meta, s.cover, s.initials, 0f, e.variantsText.takeIf { e.hasVariants }, mod, long) { vm.openSeriesEntry(e) }
        }
        remove?.let { e -> RemoveContinueDialog(e.item.name, { remove = null }) { vm.removeSeriesFromContinue(e); remove = null } }
    }
}

@Composable
private fun RemoveContinueDialog(title: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = C.Panel,
        title = { Text("Rimuovere da Continua a guardare?", color = C.Text) },
        text = { Text(title, color = C.Text2) },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Rimuovi", color = C.Danger) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Indietro", color = C.Text2) } },
    )
}

@Composable
private fun <T> EntryList(
    vm: AppViewModel,
    list: List<Entry<T>>,
    grid: Boolean,
    key: (T) -> Any,
    item: @Composable (Entry<T>, Modifier, Boolean) -> Unit,
) {
    if (list.isEmpty()) { Empty("Nessun contenuto."); return }
    val wide = LocalWide.current
    if (grid) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(if (wide) 150.dp else 110.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            // Spazio attorno per il riquadro che si ingrandisce quando ha il focus.
            contentPadding = PaddingValues(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            itemsIndexed(list, key = { _, e -> key(e.item) }) { i, e -> item(e, Modifier.initialFocus(i == 0, vm.isTv), true) }
        }
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp)) {
            itemsIndexed(list, key = { _, e -> key(e.item) }) { i, e -> item(e, Modifier.initialFocus(i == 0, vm.isTv), false) }
        }
    }
}

@Composable
fun Poster(
    title: String, meta: String, url: String?, initials: String, progress: Float, badge: String? = null,
    modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, onClick: () -> Unit,
) {
    Column(modifier.tvClickable(focusScale = 1.06f, background = Color.Transparent, focusedBackground = C.Surface, onLongClick = onLongClick, onClick = onClick).padding(4.dp)) {
        Box {
            Artwork(url, initials, Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp)), fontSize = 22)
            if (progress > 0f && progress < 1f) ProgressLine(progress, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp))
            Column(Modifier.align(Alignment.TopEnd).padding(6.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (badge != null) Badge(badge, Color(0xD0111318))
                if (progress >= 1f) Badge("Visto", C.Accent)
            }
        }
        VSpace(6.dp)
        Text(title, color = C.Text, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (meta.isNotEmpty()) Text(meta, color = C.Text3, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.height(2.dp))
    }
}

/** Film o serie in vista elenco: locandina piccola, titolo e dati. */
@Composable
fun MediaRow(
    title: String, meta: String, url: String?, initials: String, progress: Float, badge: String?,
    modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, onClick: () -> Unit,
) {
    Row(modifier.fillMaxWidth().tvClickable(focusScale = 1.02f, onLongClick = onLongClick, onClick = onClick).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(url, initials, Modifier.width(52.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)), ContentScale.Crop, 14)
        HSpace(14.dp)
        Column(Modifier.weight(1f)) {
            Text(title, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (meta.isNotEmpty()) Text(meta, color = C.Text2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (badge != null || progress >= 1f) {
                VSpace(5.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (badge != null) Badge(badge)
                    if (progress >= 1f) Badge("Visto", C.Accent)
                }
            }
            if (progress > 0f && progress < 1f) { VSpace(6.dp); ProgressLine(progress, Modifier.width(140.dp)) }
        }
    }
}

// ---------- Scelta della versione ----------

/** Titolo pubblicato più volte: si sceglie quale versione aprire (qualità letta dal nome). */
@Composable
fun VariantDialog(vm: AppViewModel) {
    val choice = vm.variantChoice ?: return
    data class Opt(val name: String, val quality: String?, val meta: String, val url: String?, val initials: String, val progress: Float, val open: () -> Unit)
    val opts = when (choice) {
        is com.carellice.iptvision.VariantChoice.Films -> choice.items.map { m: Movie ->
            Opt(m.name, com.carellice.iptvision.data.TextHelpers.qualityOf(m.name), m.meta, m.poster, m.initials, vm.positions.progress(m.key)) {
                vm.variantChoice = null; vm.openMovie(m)
            }
        }
        is com.carellice.iptvision.VariantChoice.Shows -> choice.items.map { s: Series ->
            Opt(s.name, com.carellice.iptvision.data.TextHelpers.qualityOf(s.name), s.meta, s.cover, s.initials, 0f) {
                vm.variantChoice = null; vm.openSeries(s)
            }
        }
    }
    androidx.compose.ui.window.Dialog(onDismissRequest = { vm.variantChoice = null }) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Panel).padding(20.dp),
        ) {
            Text("Scegli la versione", color = C.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(choice.title, color = C.Text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            VSpace(12.dp)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(4.dp)) {
                itemsIndexed(opts) { i, o ->
                    Row(
                        Modifier.fillMaxWidth().initialFocus(i == 0, true).tvClickable(focusScale = 1.02f, onClick = o.open).padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Artwork(o.url, o.initials, Modifier.width(44.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)), ContentScale.Crop, 12)
                        HSpace(12.dp)
                        Column(Modifier.weight(1f)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Badge(o.quality ?: "Versione ${i + 1}", C.AccentSoft)
                                if (o.progress > 0f && o.progress < 1f) Badge("Iniziato")
                                if (o.progress >= 1f) Badge("Visto", C.Accent)
                            }
                            VSpace(4.dp)
                            Text(o.name, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (o.meta.isNotEmpty()) Text(o.meta, color = C.Text3, fontSize = 12.sp, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
