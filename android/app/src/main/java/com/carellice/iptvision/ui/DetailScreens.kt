package com.carellice.iptvision.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.data.Episode
import com.carellice.iptvision.data.Movie
import com.carellice.iptvision.data.Series
import com.carellice.iptvision.data.TextHelpers

@Composable
private fun DetailFrame(vm: AppViewModel, content: @Composable (wide: Boolean) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding()) {
        val wide = maxWidth >= 720.dp
        Column(Modifier.fillMaxSize().padding(horizontal = if (wide) 40.dp else 16.dp, vertical = 12.dp)) {
            if (!vm.isTv) IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro", tint = C.Text) }
            content(wide)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MovieDetailScreen(vm: AppViewModel, m: Movie) {
    @Suppress("UNUSED_VARIABLE") val pv = vm.positionsVersion
    val resume = vm.positions.resumeMs(m.key)
    val info = vm.vodInfo
    val play = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { play.requestFocus() } }
    DetailFrame(vm) { wide ->
        val body: @Composable () -> Unit = {
            Column {
                Text(m.name, color = C.Text, fontSize = if (wide) 32.sp else 24.sp, fontWeight = FontWeight.Bold)
                VSpace(6.dp)
                Text(TextHelpers.joinMeta(info?.year ?: m.year, info?.genre, info?.duration, m.meta.substringAfter("·", "").trim().ifEmpty { null }), color = C.Text2)
                VSpace(18.dp)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(if (resume > 0) "Riprendi da ${TextHelpers.formatTime(resume)}" else "Guarda", Icons.Default.PlayArrow, primary = true,
                        modifier = Modifier.focusRequester(play)) { vm.playMovie(m) }
                    if (resume > 0) ActionButton("Dall'inizio", Icons.Default.Replay) { vm.playMovie(m, fromStart = true) }
                    if (!vm.isTv) DownloadButton(vm, m.key) { vm.downloadMovie(m) }
                }
                VSpace(18.dp)
                info?.plot?.let { Text(it, color = C.Text, fontSize = 15.sp, lineHeight = 22.sp) }
                info?.director?.let { VSpace(10.dp); Text("Regia: $it", color = C.Text2, fontSize = 13.sp) }
                info?.cast?.let { VSpace(4.dp); Text("Cast: $it", color = C.Text2, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(top = 20.dp)) {
                Artwork(m.poster, m.initials, Modifier.width(260.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(14.dp)), fontSize = 30)
                HSpace(32.dp)
                Box(Modifier.weight(1f).verticalScroll(rememberScrollState())) { body() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Artwork(m.poster, m.initials, Modifier.width(180.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).align(Alignment.CenterHorizontally), fontSize = 26)
                VSpace(16.dp)
                body()
            }
        }
    }
}

@Composable
fun SeriesDetailScreen(vm: AppViewModel, s: Series) {
    @Suppress("UNUSED_VARIABLE") val pv = vm.positionsVersion
    val info = vm.seriesInfo
    val episodes = info?.episodes ?: emptyList()
    val seasons = remember(episodes) { episodes.map { it.season }.distinct().sorted() }
    val resumeEp = remember(episodes, vm.positionsVersion) { vm.resumeEpisode(episodes, s.seriesId) }
    var season by rememberSaveable(s.seriesId) { mutableIntStateOf(-1) }
    if (season < 0 && resumeEp != null) season = resumeEp.season
    val shown = episodes.filter { it.season == season }
    val play = remember { FocusRequester() }
    LaunchedEffect(resumeEp != null) { if (resumeEp != null) runCatching { play.requestFocus() } }

    DetailFrame(vm) { wide ->
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 8.dp, horizontal = 4.dp)) {
            item {
                Row {
                    Artwork(s.cover, s.initials, Modifier.width(if (wide) 180.dp else 110.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)), fontSize = 24)
                    HSpace(20.dp)
                    Column(Modifier.weight(1f)) {
                        Text(s.name, color = C.Text, fontSize = if (wide) 30.sp else 22.sp, fontWeight = FontWeight.Bold)
                        VSpace(4.dp)
                        Text(TextHelpers.joinMeta(info?.year ?: s.year, info?.genre ?: s.genre, if (seasons.isNotEmpty()) "${seasons.size} stagioni" else null), color = C.Text2, fontSize = 13.sp)
                        VSpace(10.dp)
                        (info?.plot ?: s.plot)?.let { Text(it, color = C.Text, fontSize = 14.sp, maxLines = if (wide) 6 else 4, overflow = TextOverflow.Ellipsis) }
                        VSpace(14.dp)
                        if (resumeEp != null) {
                            val r = vm.positions.resumeMs(resumeEp.key)
                            val label = if (r > 0) "Riprendi ${resumeEp.label} da ${TextHelpers.formatTime(r)}" else "Guarda ${resumeEp.label}"
                            ActionButton(label, Icons.Default.PlayArrow, primary = true, modifier = Modifier.focusRequester(play)) {
                                vm.playEpisode(s, resumeEp, episodes)
                            }
                        }
                    }
                }
            }
            if (info == null) {
                item { if (vm.seriesInfoLoading) Loading("Caricamento episodi…", Modifier.fillMaxWidth().padding(30.dp)) else Empty("Episodi non disponibili.") }
            } else if (episodes.isEmpty()) {
                item { Empty("Nessun episodio.") }
            } else {
                item {
                    val state = rememberLazyListState(initialFirstVisibleItemIndex = seasons.indexOf(season).coerceAtLeast(0))
                    LazyRow(state = state, horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 14.dp)) {
                        items(seasons) { n -> Pill("Stagione $n", n == season, onFocus = { if (vm.isTv) season = n }) { season = n } }
                    }
                }
                if (!vm.isTv) item {
                    val missing = shown.filter { vm.downloads.get(it.key) == null }
                    if (missing.isNotEmpty()) ActionButton("Scarica la stagione $season (${missing.size} episodi)", Icons.Default.Download, modifier = Modifier.padding(bottom = 6.dp)) {
                        missing.forEach { vm.downloadEpisode(s, it) }
                    }
                }
                items(shown, key = { it.id }) { ep -> EpisodeRow(vm, s, ep, episodes, ep.id == resumeEp?.id) }
            }
        }
    }
}

@Composable
private fun EpisodeRow(vm: AppViewModel, s: Series, ep: Episode, all: List<Episode>, current: Boolean) {
    val progress = vm.positions.progress(ep.key)
    Row(
        Modifier.fillMaxWidth().tvClickable(focusScale = 1.02f) { vm.playEpisode(s, ep, all) }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Artwork(ep.image ?: s.cover, ep.label, Modifier.width(150.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)), fontSize = 14)
            if (progress > 0f && progress < 1f) ProgressLine(progress, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(5.dp))
        }
        HSpace(14.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ep.label, color = if (current) C.Accent2 else C.Text3, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                if (ep.durationText.isNotEmpty()) { HSpace(8.dp); Text(ep.durationText, color = C.Text3, fontSize = 12.sp) }
                if (progress >= 1f) { HSpace(8.dp); Icon(Icons.Default.CheckCircle, "Visto", tint = C.Accent, modifier = Modifier.size(16.dp)) }
            }
            Text(ep.displayTitle, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            ep.plot?.let { Text(it, color = C.Text2, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        if (!vm.isTv) DownloadButton(vm, ep.key, compact = true) { vm.downloadEpisode(s, ep) }
    }
}
