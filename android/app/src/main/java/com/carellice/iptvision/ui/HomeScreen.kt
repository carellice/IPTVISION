package com.carellice.iptvision.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.pointer.pointerInput

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material.icons.filled.Download
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
import androidx.compose.foundation.focusGroup
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
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
    Section.Downloads -> Icons.Default.Download
    Section.Settings -> Icons.Default.Settings
}

/** Larghezza da tablet/TV: categorie a sinistra e menu laterale; sotto, layout da telefono. */
val LocalWide = androidx.compose.runtime.compositionLocalOf { false }

@Composable
fun HomeScreen(vm: AppViewModel, onVoiceSearch: () -> Unit) {
    // Rete del server di casa (VPN sì o no) appena si apre l'app; poi la aggiorna il giro ogni 30 secondi.
    LaunchedEffect(Unit) { vm.loadServerNetwork() }
    LaunchedEffect(vm.section) {
        if (vm.section == Section.Movies) vm.ensureMovies()
        if (vm.section == Section.Series) vm.ensureSeries()
    }
    BoxWithConstraints(Modifier.fillMaxSize().material(C.Bg)) {
        val wide = maxWidth >= 720.dp
        val short = maxHeight < 500.dp
        androidx.compose.runtime.CompositionLocalProvider(LocalWide provides wide) {
            if (Skin.metro) Pivot(vm, wide, onVoiceSearch)
            else if (wide) {
                Row(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    // Telefono in orizzontale: largo ma basso, il menu scorre e l'orologio sparisce.
                    SideNav(vm, compact = short)
                    Column(Modifier.weight(1f).fillMaxHeight().padding(start = 8.dp, end = 24.dp, top = 20.dp)) {
                        Content(vm, onVoiceSearch)
                    }
                }
            } else {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp).padding(top = 12.dp)) { Content(vm, onVoiceSearch) }
                    NavigationBar(Modifier.metalBar(), containerColor = Color.Transparent) {
                        vm.sections.forEach { s ->
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

private fun Section.pivotLabel() = when (this) {
    Section.Live -> "tv"
    Section.Series -> "serie"
    else -> title.lowercase(Locale.ITALY)
}

/**
 * Modern UI (pivot di Windows Phone): nome dell'app in maiuscoletto, le sezioni come grandi voci minuscole
 * con quella aperta per prima e in bianco, la pagina che entra da destra. Si cambia sezione toccando una
 * voce, scorrendo di lato sulle voci o col telecomando (◀ ▶ sulle voci, OK per aprire).
 */
@Composable
private fun Pivot(vm: AppViewModel, wide: Boolean, onVoiceSearch: () -> Unit) {
    val sections = vm.sections
    val i = sections.indexOf(vm.section).coerceAtLeast(0)
    val ordered = sections.drop(i) + sections.take(i)
    val pad = if (wide) 24.dp else 12.dp
    var drag by remember { mutableFloatStateOf(0f) }
    val step = { d: Int -> vm.section = sections[(i + d + sections.size) % sections.size] }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = pad, end = pad, top = if (wide) 14.dp else 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("IPTVISION", color = C.Text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp, modifier = Modifier.weight(1f))
            if (wide) {
                val now by produceState(System.currentTimeMillis()) { while (true) { value = System.currentTimeMillis(); delay(15_000) } }
                Text(SimpleDateFormat("HH:mm", Locale.ITALY).format(Date(now)), color = C.Text, fontSize = 14.sp, fontWeight = FontWeight.Light)
                HSpace(16.dp)
            }
            ServerNetworkLine(vm)
        }
        Row(
            Modifier.fillMaxWidth().clipToBounds().padding(horizontal = pad)
                .pointerInput(i) {
                    detectHorizontalDragGestures(
                        onDragStart = { drag = 0f },
                        onDragEnd = { if (kotlin.math.abs(drag) > 120) step(if (drag < 0) 1 else -1) },
                    ) { _, d -> drag += d }
                },
        ) {
            ordered.forEach { s ->
                val selected = s == vm.section
                val color by animateColorAsState(if (selected) C.Text else C.Text3, label = "pivot")
                Text(
                    s.pivotLabel(),
                    color = color,
                    fontSize = if (wide) 56.sp else 42.sp,
                    lineHeight = if (wide) 72.sp else 54.sp,
                    fontWeight = FontWeight.Light,
                    letterSpacing = (-1).sp,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.padding(end = if (wide) 28.dp else 20.dp)
                        .tvClickable(background = Color.Transparent, focusedBackground = Color.Transparent, focusScale = 1f) { vm.section = s },
                )
            }
        }
        AnimatedContent(
            targetState = vm.section,
            transitionSpec = {
                val d = if (sections.indexOf(targetState) >= sections.indexOf(initialState)) 1 else -1
                val ease = CubicBezierEasing(0.1f, 0.9f, 0.2f, 1f)
                (slideInHorizontally(tween(320, easing = ease)) { it / 5 * d } + fadeIn(tween(220))) togetherWith
                    (slideOutHorizontally(tween(160)) { -it / 8 * d } + fadeOut(tween(120)))
            },
            label = "pivot",
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = pad).padding(top = 8.dp),
        ) { target ->
            Column(Modifier.fillMaxSize()) { Content(vm, onVoiceSearch, target) }
        }
    }
}

@Composable
private fun Content(vm: AppViewModel, onVoiceSearch: () -> Unit, section: Section = vm.section) {
    vm.status?.let { Text(it, color = C.Text2, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp)) }
    when (section) {
        Section.Live -> LiveSection(vm)
        Section.Movies -> MoviesSection(vm)
        Section.Series -> SeriesSection(vm)
        Section.Search -> SearchSection(vm, onVoiceSearch)
        Section.Downloads -> DownloadsSection(vm)
        Section.Settings -> SettingsSection(vm)
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun SideNav(vm: AppViewModel, compact: Boolean) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (vm.isTv) runCatching { first.requestFocus() } }
    Column(
        Modifier.width(220.dp).fillMaxHeight().material(C.Panel)
            // Entrando con ◀ si torna sulla sezione aperta, non sulla voce più vicina.
            .focusProperties { onEnter = { first.requestFocus() } }
            .focusGroup()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 6.dp, top = if (compact) 0.dp else 8.dp, bottom = if (compact) 6.dp else 18.dp)) {
                Image(painterResource(R.drawable.logo), null, Modifier.size(34.dp).clip(skinCorners(8.dp)))
                HSpace(10.dp)
                Text("IPTVISION", color = C.Text, fontWeight = FontWeight.Bold, fontSize = 19.sp)
            }
            vm.sections.forEach { s ->
                val selected = vm.section == s
                Row(
                    Modifier.fillMaxWidth()
                        .then(if (selected) Modifier.focusRequester(first) else Modifier)
                        .tvClickable(
                            focusScale = 1.02f,
                            background = if (selected) C.AccentSoft else Color.Transparent,
                            focusedBackground = C.SurfacePressed,
                        ) { vm.section = s } // Col telecomando si scorre il menu e si apre la sezione solo con OK.
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(s.icon(), null, tint = if (selected) C.Accent else C.Text2, modifier = Modifier.size(22.dp))
                    HSpace(12.dp)
                    Text(s.title, color = if (selected) C.Text else C.Text2, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
        if (!compact) Clock()
        ServerNetworkLine(vm, Modifier.padding(horizontal = 6.dp))
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

