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
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.wrapContentWidth
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
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Theaters
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.ViewModule
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Menu
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.drawBehind
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
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun Section.icon(): ImageVector = when (this) {
    Section.Live -> Icons.Default.Tv
    Section.Movies -> Icons.Default.Movie
    Section.Series -> Icons.Default.ViewModule
    Section.Discover -> Icons.Default.Theaters
    Section.MyList -> Icons.Default.Bookmark
    Section.Search -> Icons.Default.Search
    Section.Downloads -> Icons.Default.Download
    Section.Settings -> Icons.Default.Settings
}

/** Larghezza da tablet/TV: categorie a sinistra e menu laterale; sotto, layout da telefono. */
val LocalWide = androidx.compose.runtime.compositionLocalOf { false }

/** Margine laterale che la sezione mette da sé: "Film e serie" va da bordo a bordo, come le app di streaming. */
val LocalEdge = androidx.compose.runtime.compositionLocalOf { 0.dp }

@Composable
fun HomeScreen(vm: AppViewModel, onVoiceSearch: () -> Unit) {
    // Rete del server di casa (VPN sì o no) appena si apre l'app; poi la aggiorna il giro ogni 30 secondi.
    LaunchedEffect(Unit) { vm.loadServerNetwork() }
    LaunchedEffect(vm.section) {
        if (vm.section == Section.Movies) vm.ensureMovies()
        if (vm.section == Section.Series) vm.ensureSeries()
        if (vm.section == Section.MyList) { vm.ensureMovies(); vm.ensureSeries() }
    }
    BoxWithConstraints(Modifier.fillMaxSize().material(C.Bg)) {
        val wide = maxWidth >= 720.dp
        val short = maxHeight < 500.dp
        androidx.compose.runtime.CompositionLocalProvider(LocalWide provides wide) {
            // Modern UI: pivot sugli schermi larghi, sul telefono la barra in basso come gli altri stili.
            if (Skin.metro && wide) Pivot(vm, wide, onVoiceSearch)
            else if (wide) {
                // TV: il menu è una colonna di icone che si apre sopra i contenuti
                // quando ci arriva il focus, come nelle app di streaming. Sempre lo stesso SideNav, così il focus non si perde.
                val rail = vm.isTv
                var focused by remember { mutableStateOf(false) }
                // Telefono e tablet: il menu si chiude a sole icone col pulsante ☰ e lascia spazio ai contenuti.
                var navOpen by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(true) }
                val navW by androidx.compose.animation.core.animateDpAsState(
                    if (rail || !navOpen) RailWidth else NavWidth, tween(220, easing = androidx.compose.animation.core.FastOutSlowInEasing), label = "nav",
                )
                Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().onFocusChanged { focused = it.hasFocus }) {
                Row(Modifier.fillMaxSize()) {
                    Box(Modifier.width(navW))
                    if (vm.section == Section.Discover) {
                        Column(Modifier.weight(1f).fillMaxHeight()) {
                            androidx.compose.runtime.CompositionLocalProvider(LocalEdge provides 24.dp) { Content(vm, onVoiceSearch) }
                        }
                    } else Column(Modifier.weight(1f).fillMaxHeight().padding(start = 8.dp, end = 24.dp, top = 20.dp)) {
                        Content(vm, onVoiceSearch)
                    }
                }
                    // Telefono in orizzontale: largo ma basso, il menu scorre e l'orologio sparisce.
                    SideNav(vm, compact = short, rail = rail, homeFocused = { focused }, collapsed = !navOpen, onToggle = { navOpen = !navOpen })
                }
            } else {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    if (vm.section == Section.Discover) {
                        Column(Modifier.weight(1f)) {
                            androidx.compose.runtime.CompositionLocalProvider(LocalEdge provides 14.dp) { Content(vm, onVoiceSearch) }
                        }
                    } else Column(Modifier.weight(1f).padding(horizontal = 14.dp).padding(top = 12.dp)) { Content(vm, onVoiceSearch) }
                    // Dueffe: barra flottante alta 68, raggio 28, colore Nav con un filo di bordo oro.
                    val df = Skin.dueffe
                    NavigationBar(
                        if (Skin.nothing) Modifier.background(C.Bg).drawBehind { drawLine(Color(0xFF222222), androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), 1.dp.toPx()) }
                        else if (!df) Modifier.metalBar() else Modifier.navigationBarsPadding().padding(start = 14.dp, end = 14.dp, bottom = 10.dp)
                            .height(68.dp).clip(RoundedCornerShape(28.dp)).background(Dueffe.Nav)
                            .border(1.dp, Dueffe.Line, RoundedCornerShape(28.dp)).padding(horizontal = 6.dp),
                        containerColor = Color.Transparent,
                        windowInsets = if (df) androidx.compose.foundation.layout.WindowInsets(0) else androidx.compose.material3.NavigationBarDefaults.windowInsets,
                    ) {
                        vm.sections.forEach { s ->
                            NavigationBarItem(
                                selected = vm.section == s,
                                onClick = { if (s == Section.Discover) resetDiscoverScroll(); vm.section = s },
                                icon = { Icon(s.icon(), null) },
                                label = {
                                    val l = navLabel(s)
                                    // Nothing: voci in Space Mono maiuscolo. Sempre su una riga sola.
                                    if (Skin.nothing) Text(l.uppercase(), fontSize = 10.sp, fontFamily = Nothing.Mono, letterSpacing = 0.8.sp, maxLines = 1, softWrap = false)
                                    // Modern UI: voci minuscole, come la app bar di Windows Phone.
                                    else if (Skin.metro) Text(l.lowercase(Locale.ITALY), fontSize = 11.sp, maxLines = 1, softWrap = false)
                                    else Text(l, fontSize = 11.sp, maxLines = 1, softWrap = false)
                                },
                                // Modern UI: niente pillola, l'icona scelta nel colore d'accento.
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = if (Skin.metro) C.Accent else C.OnAccent,
                                    indicatorColor = if (Skin.metro) Color.Transparent else C.Accent,
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

/** Voci corte per la barra in basso: "Film e serie" andrebbe su due righe. */
private fun navLabel(s: Section) = when (s) {
    Section.Live -> "TV"
    Section.Discover -> "Film/serie"
    Section.MyList -> "Lista"
    Section.Settings -> "Altro"
    else -> s.title
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
    vm.status?.let { Text(it, color = C.Text2, fontSize = 13.sp, modifier = Modifier.padding(start = LocalEdge.current, bottom = 6.dp)) }
    when (section) {
        Section.Live -> LiveSection(vm)
        Section.Movies -> MoviesSection(vm)
        Section.Series -> SeriesSection(vm)
        Section.Discover -> DiscoverSection(vm)
        Section.MyList -> MyListSection(vm)
        Section.Search -> SearchSection(vm, onVoiceSearch)
        Section.Downloads -> DownloadsSection(vm)
        Section.Settings -> SettingsSection(vm)
    }
}

private val NavWidth = 220.dp
private val RailWidth = 76.dp

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun SideNav(vm: AppViewModel, compact: Boolean, rail: Boolean = false, homeFocused: () -> Boolean = { false }, collapsed: Boolean = false, onToggle: () -> Unit = {}) {
    val first = remember { FocusRequester() }
    // All'avvio il focus va al menu; tornando da una scheda o dal player solo se la sezione non l'ha già rimesso dov'era.
    // Il focus chiesto da qui (avvio, Indietro) apre il menu; quello arrivato da solo no (vedi onFocusChanged).
    val asked = remember { booleanArrayOf(false) }
    LaunchedEffect(Unit) { if (vm.isTv) { delay(150); if (!homeFocused()) { asked[0] = true; runCatching { first.requestFocus() } } } }
    var inside by remember { mutableStateOf(false) }
    LaunchedEffect(vm.focusMenu) { if (vm.focusMenu > 0) { asked[0] = true; runCatching { first.requestFocus() } } }
    // Scelta una voce, il menu si chiude subito e resta chiuso finché il focus non ci torna.
    var closed by remember { mutableStateOf(false) }
    val open = if (rail) inside && !closed else !collapsed
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // Apertura fluida: scritte e orologio restano composti (solo trasparenti), la larghezza cambia in fase di layout:
    // niente ricomposizione a ogni fotogramma, che sui TV faceva scattare l'animazione.
    val t by androidx.compose.animation.core.animateFloatAsState(
        if (open) 1f else 0f, tween(220, easing = androidx.compose.animation.core.FastOutSlowInEasing), label = "rail",
    )
    val fade = Modifier.graphicsLayer { alpha = t }
    Column(
        Modifier
            .layout { m, c ->
                val w = (RailWidth + (NavWidth - RailWidth) * t).roundToPx()
                val p = m.measure(c.copy(minWidth = w, maxWidth = w))
                layout(w, p.height) { p.place(0, 0) }
            }
            .fillMaxHeight()
            .clipToBounds()
            .then(
                if (open) Modifier.material(C.Panel)
                else Modifier.background(androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(C.Bg, C.Bg.copy(alpha = 0.6f))))
            )
            .onFocusChanged {
                val gained = it.hasFocus && !inside
                inside = it.hasFocus; vm.menuFocused = it.hasFocus
                if (!it.hasFocus) closed = false
                // Il titolo col focus sparisce (righe ricaricate, titolo rimosso) e Android passa il focus al menu:
                // senza ◀ dell'utente il menu resta chiuso e il focus torna ai contenuti appena possibile.
                if (gained && rail && !asked[0] && (vm.section == Section.Discover || vm.section == Section.MyList) &&
                    android.os.SystemClock.uptimeMillis() - vm.lastLeftAt > 600
                ) {
                    closed = true
                    val start = vm.lastKeyAt
                    scope.launch {
                        repeat(120) {
                            if (!inside || vm.lastKeyAt != start) return@launch
                            if (runCatching { focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Right) }.getOrDefault(false)) return@launch
                            delay(250)
                        }
                    }
                }
                if (gained) asked[0] = false
            }
            // Entrando con ◀ si torna sulla sezione aperta, non sulla voce più vicina. Con ▲ ▼ dai contenuti nel menu
            // non si entra mai: senza un titolo pronto sotto, il focus finiva qui e poi tornava a destra su un titolo a caso.
            .focusProperties {
                onEnter = {
                    if (requestedFocusDirection == androidx.compose.ui.focus.FocusDirection.Up ||
                        requestedFocusDirection == androidx.compose.ui.focus.FocusDirection.Down
                    ) cancelFocusChange() else first.requestFocus()
                }
            }
            .focusGroup()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 6.dp, top = if (compact) 0.dp else 8.dp, bottom = if (compact) 6.dp else 18.dp)) {
                if (rail) Image(painterResource(R.drawable.logo), null, Modifier.size(34.dp).clip(skinCorners(8.dp)))
                else Box(Modifier.size(34.dp).tvClickable(shape = androidx.compose.foundation.shape.CircleShape, background = Color.Transparent, onClick = onToggle), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Menu, if (open) "Chiudi menu" else "Apri menu", tint = C.Text, modifier = Modifier.size(24.dp))
                }
                HSpace(10.dp)
                Text("IPTVISION", color = C.Text, fontWeight = FontWeight.Bold, fontSize = 19.sp, maxLines = 1, softWrap = false, modifier = fade)
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
                            // Ci si sposta nel menu: la pagina che finisce di caricare non deve più rubare il focus.
                            onFocus = { if (!selected) vm.focusContent = false },
                        ) { // Col telecomando si scorre il menu e si apre la sezione solo con OK.
                            if (s == Section.Discover) resetDiscoverScroll()
                            vm.section = s
                            if (vm.isTv) {
                                closed = true
                                vm.focusContent = true
                                // La sezione che sa dove mettere il focus lo prende da sé; altrimenti il primo elemento a destra.
                                // Pagina ancora in caricamento (niente a destra): si riprova finché è pronta, senza riaprire il menu.
                                // "Film e serie" lo prende da sé appena compaiono i filtri.
                                scope.launch {
                                    delay(150)
                                    while (vm.focusContent && vm.section == s) {
                                        if ((s != Section.Discover || vm.discoverOpen != null) && focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Right)) { vm.focusContent = false; break }
                                        delay(250)
                                    }
                                }
                            }
                        }
                        .padding(horizontal = 13.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(s.icon(), s.title, tint = if (selected) C.Accent else C.Text2, modifier = Modifier.size(22.dp))
                    HSpace(12.dp)
                    Text(s.title, color = if (selected) C.Text else C.Text2, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, softWrap = false, modifier = fade)
                }
            }
        }
        // Larghezza fissa da menu aperto: nella colonna stretta orologio e rete andavano a capo lettera per lettera,
        // diventavano altissimi e schiacciavano le icone del menu compatto.
        Column(fade.wrapContentWidth(Alignment.Start, unbounded = true).width(NavWidth - 28.dp)) {
            if (!compact) Clock()
            ServerNetworkLine(vm, Modifier.padding(horizontal = 6.dp))
        }
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

