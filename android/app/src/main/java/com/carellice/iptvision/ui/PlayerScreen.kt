package com.carellice.iptvision.ui

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.KeyEvent as AKey
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C as MC
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.Playing
import com.carellice.iptvision.data.TextHelpers
import com.carellice.iptvision.player.PlaybackState
import kotlinx.coroutines.delay

private enum class Overlay { None, Info, Controls }

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(vm: AppViewModel) {
    val p = vm.playing ?: return
    val pc = vm.player
    val live = p is Playing.Live
    val activity = LocalContext.current as Activity
    val view = LocalView.current

    // Telefono: orizzontale e a schermo intero finché si guarda.
    DisposableEffect(Unit) {
        val window = activity.window
        val ctl = WindowCompat.getInsetsController(window, view)
        ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        ctl.hide(WindowInsetsCompat.Type.systemBars())
        view.keepScreenOn = true
        val old = activity.requestedOrientation
        if (!vm.isTv) activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose {
            ctl.show(WindowInsetsCompat.Type.systemBars())
            view.keepScreenOn = false
            activity.requestedOrientation = old
        }
    }

    var overlay by remember { mutableStateOf(Overlay.Info) }
    var interaction by remember { mutableIntStateOf(0) }
    var panel by remember { mutableStateOf(false) }
    var tracks by remember { mutableStateOf(false) }
    var digits by remember { mutableStateOf("") }
    val rootFocus = remember { FocusRequester() }
    val playFocus = remember { FocusRequester() }

    fun show(o: Overlay) { overlay = o; interaction++ }

    // Le informazioni compaiono a ogni cambio di canale/episodio e spariscono da sole.
    val itemKey = when (p) { is Playing.Live -> "c${p.channel.streamId}"; is Playing.Film -> p.movie.key; is Playing.Ep -> p.episode.key }
    LaunchedEffect(itemKey) { if (overlay == Overlay.None) show(Overlay.Info) }
    LaunchedEffect(overlay, interaction, pc.state) {
        if (overlay != Overlay.None && pc.state == PlaybackState.Playing && !tracks) {
            delay(if (overlay == Overlay.Info) 4000 else 6000)
            overlay = Overlay.None
        }
    }
    LaunchedEffect(overlay, panel, tracks) {
        when {
            panel || tracks -> {}
            overlay == Overlay.Controls -> runCatching { playFocus.requestFocus() }
            else -> runCatching { rootFocus.requestFocus() }
        }
    }
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(1500)
        digits.toIntOrNull()?.let { vm.playChannelNumber(it) }
        digits = ""
    }
    LaunchedEffect(vm.player.state) { if (pc.state == PlaybackState.Reconnecting) show(Overlay.Info) }

    fun onBack() {
        when {
            tracks -> tracks = false
            panel -> panel = false
            overlay == Overlay.Controls -> overlay = Overlay.None
            else -> vm.back()
        }
    }
    BackHandler { onBack() }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            // Il tasto Indietro del telecomando si gestisce qui: altrimenti Compose lo userebbe
            // prima per togliere il focus dal pannello aperto, che resterebbe a schermo.
            .onPreviewKeyEvent { e ->
                if (e.key != Key.Back) return@onPreviewKeyEvent false
                if (e.type == KeyEventType.KeyUp) onBack()
                true
            }
            .focusRequester(rootFocus)
            .focusable()
            .onKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                val code = e.key.nativeKeyCode
                when (code) {
                    AKey.KEYCODE_DPAD_UP, AKey.KEYCODE_CHANNEL_UP, AKey.KEYCODE_PAGE_UP, AKey.KEYCODE_MEDIA_NEXT ->
                        if (live) vm.zap(+1) else if (code == AKey.KEYCODE_DPAD_UP) { pc.seekBy(60_000); show(Overlay.Info) } else vm.playEpisodeOffset(+1)
                    AKey.KEYCODE_DPAD_DOWN, AKey.KEYCODE_CHANNEL_DOWN, AKey.KEYCODE_PAGE_DOWN, AKey.KEYCODE_MEDIA_PREVIOUS ->
                        if (live) vm.zap(-1) else if (code == AKey.KEYCODE_DPAD_DOWN) { pc.seekBy(-60_000); show(Overlay.Info) } else vm.playEpisodeOffset(-1)
                    AKey.KEYCODE_DPAD_LEFT -> if (live) panel = true else { pc.seekBy(-10_000); show(Overlay.Info) }
                    AKey.KEYCODE_DPAD_RIGHT -> if (live) show(Overlay.Info) else { pc.seekBy(10_000); show(Overlay.Info) }
                    AKey.KEYCODE_MEDIA_FAST_FORWARD -> { pc.seekBy(30_000); show(Overlay.Info) }
                    AKey.KEYCODE_MEDIA_REWIND -> { pc.seekBy(-30_000); show(Overlay.Info) }
                    AKey.KEYCODE_DPAD_CENTER, AKey.KEYCODE_ENTER, AKey.KEYCODE_NUMPAD_ENTER -> show(Overlay.Controls)
                    AKey.KEYCODE_MEDIA_PLAY_PAUSE, AKey.KEYCODE_SPACE, AKey.KEYCODE_MEDIA_PLAY, AKey.KEYCODE_MEDIA_PAUSE -> { pc.togglePause(); show(Overlay.Info) }
                    AKey.KEYCODE_INFO, AKey.KEYCODE_GUIDE, AKey.KEYCODE_I -> show(if (overlay == Overlay.None) Overlay.Info else Overlay.None)
                    AKey.KEYCODE_MENU -> if (live) { vm.toggleFavorite((p as Playing.Live).channel); show(Overlay.Info) } else show(Overlay.Controls)
                    in AKey.KEYCODE_0..AKey.KEYCODE_9, in AKey.KEYCODE_NUMPAD_0..AKey.KEYCODE_NUMPAD_9 -> {
                        if (!live) return@onKeyEvent false
                        val d = if (code >= AKey.KEYCODE_NUMPAD_0) code - AKey.KEYCODE_NUMPAD_0 else code - AKey.KEYCODE_0
                        if (digits.length < 5) digits += d
                    }
                    else -> return@onKeyEvent false
                }
                true
            }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                show(if (overlay == Overlay.Controls) Overlay.None else Overlay.Controls)
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                    setKeepContentOnPlayerReset(true)
                    isFocusable = false
                    player = pc.player
                }
            },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )

        if (pc.state == PlaybackState.Connecting || pc.state == PlaybackState.Buffering || pc.state == PlaybackState.Reconnecting) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Color.White)
                if (pc.state == PlaybackState.Reconnecting) {
                    VSpace(12.dp)
                    Text("Riconnessione… tentativo ${pc.attempt}", color = Color.White, modifier = Modifier.background(Color(0x99000000), RoundedCornerShape(8.dp)).padding(10.dp, 6.dp))
                }
            }
        }

        if (digits.isNotEmpty()) {
            Text(digits, color = Color.White, fontSize = 48.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).safeDrawingPadding().padding(28.dp).background(Color(0xAA000000), RoundedCornerShape(12.dp)).padding(18.dp, 6.dp))
        }

        AnimatedVisibility(overlay != Overlay.None, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize()) {
                // Sfumature in alto e in basso per leggere il testo su qualsiasi immagine.
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.35f).align(Alignment.TopCenter).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))))
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.55f).align(Alignment.BottomCenter).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xEE000000)))))
                TopBar(vm, p, Modifier.align(Alignment.TopCenter))
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(horizontal = 28.dp, vertical = 18.dp)) {
                    InfoBlock(vm, p)
                    if (overlay == Overlay.Controls) {
                        VSpace(14.dp)
                        Controls(vm, p, playFocus, onChannels = { panel = true }, onTracks = { tracks = true }, onAny = { interaction++ })
                    } else if (vm.isTv) {
                        VSpace(10.dp)
                        Text(
                            if (live) "▲▼ canale  ·  ◀ elenco canali  ·  OK comandi  ·  Menu preferito" else "◀▶ 10 s  ·  ▲▼ 1 min  ·  OK comandi",
                            color = C.Text3, fontSize = 12.sp,
                        )
                    }
                }
            }
        }

        AnimatedVisibility(panel && p is Playing.Live, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
            if (p is Playing.Live) ChannelPanel(vm, p) { panel = false }
        }

        if (tracks) TracksPanel(vm) { tracks = false }

        vm.nextEpisodeCountdown?.let { s -> NextEpisodeCard(vm, s, Modifier.align(Alignment.BottomEnd)) }
    }
}

@Composable
private fun TopBar(vm: AppViewModel, p: Playing, modifier: Modifier) {
    Row(modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (!vm.isTv) {
            Box(Modifier.clip(RoundedCornerShape(50)).clickable { vm.back() }.padding(10.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro", tint = Color.White)
            }
            HSpace(8.dp)
        }
        val title = when (p) {
            is Playing.Live -> "TV in diretta"
            is Playing.Film -> "Film"
            is Playing.Ep -> p.series.name
        }
        Text(title, color = C.Text2, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (vm.player.videoSize.isNotEmpty()) { Badge(vm.player.videoSize); HSpace(12.dp) }
        Text(TextHelpers.clock(System.currentTimeMillis() / 1000), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun InfoBlock(vm: AppViewModel, p: Playing) {
    val pc = vm.player
    when (p) {
        is Playing.Live -> {
            @Suppress("UNUSED_VARIABLE") val tick = vm.epgVersion
            val ch = p.channel
            val (now, next) = vm.epg.nowNext(ch)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Artwork(ch.logo, ch.initials, Modifier.size(width = 96.dp, height = 64.dp).clip(RoundedCornerShape(10.dp)), ContentScale.Fit, 18)
                HSpace(16.dp)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(C.Live))
                        HSpace(8.dp)
                        if (ch.num > 0) { Text("${ch.num}", color = C.Text2, fontSize = 18.sp); HSpace(10.dp) }
                        Text(ch.name, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (ch.streamId in vm.favorites) { HSpace(8.dp); Icon(Icons.Default.Star, null, tint = C.Star, modifier = Modifier.size(20.dp)) }
                    }
                    if (now != null) {
                        Text("${now.timeRange}  ${now.title}", color = C.Text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        VSpace(5.dp)
                        ProgressLine(now.progressAt(System.currentTimeMillis() / 1000), Modifier.fillMaxWidth(0.5f))
                    }
                    if (next != null) {
                        VSpace(4.dp)
                        Text("Dopo: ${next.timeRange.substringBefore(' ')}  ${next.title}", color = C.Text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        is Playing.Film, is Playing.Ep -> {
            val title = if (p is Playing.Film) p.movie.name else (p as Playing.Ep).let { "${it.episode.label} · ${it.episode.displayTitle}" }
            Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            VSpace(8.dp)
            val dur = pc.durationMs
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(TextHelpers.formatTime(pc.positionMs), color = C.Text, fontSize = 13.sp)
                HSpace(12.dp)
                ProgressLine(if (dur > 0) pc.positionMs.toFloat() / dur else 0f, Modifier.weight(1f), height = 4.dp)
                HSpace(12.dp)
                Text(if (dur > 0) TextHelpers.formatTime(dur) else "--:--", color = C.Text, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun Controls(vm: AppViewModel, p: Playing, playFocus: FocusRequester, onChannels: () -> Unit, onTracks: () -> Unit, onAny: () -> Unit) {
    val pc = vm.player
    val paused = pc.state == PlaybackState.Paused
    if (p !is Playing.Live && pc.durationMs > 0) {
        var dragging by remember { mutableStateOf<Float?>(null) }
        Slider(
            value = dragging ?: (pc.positionMs.toFloat() / pc.durationMs),
            onValueChange = { dragging = it; onAny() },
            onValueChangeFinished = { dragging?.let { pc.seekTo((it * pc.durationMs).toLong()) }; dragging = null },
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = C.Accent, inactiveTrackColor = C.StrokeStrong),
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        fun act(f: () -> Unit): () -> Unit = { onAny(); f() }
        when (p) {
            is Playing.Live -> {
                RoundButton(Icons.Default.KeyboardArrowDown, "Canale precedente", onClick = act { vm.zap(-1) })
                RoundButton(if (paused) Icons.Default.PlayArrow else Icons.Default.Pause, "Pausa", big = true, modifier = Modifier.focusRequester(playFocus), onClick = act { pc.togglePause() })
                RoundButton(Icons.Default.KeyboardArrowUp, "Canale successivo", onClick = act { vm.zap(+1) })
                RoundButton(Icons.AutoMirrored.Filled.List, "Canali", onClick = act(onChannels))
                val fav = p.channel.streamId in vm.favorites
                RoundButton(if (fav) Icons.Default.Star else Icons.Default.StarBorder, "Preferito", tint = if (fav) C.Star else Color.White, onClick = act { vm.toggleFavorite(p.channel) })
            }
            else -> {
                if (p is Playing.Ep) RoundButton(Icons.Default.SkipPrevious, "Episodio precedente", onClick = act { vm.playEpisodeOffset(-1) })
                RoundButton(Icons.Default.Replay10, "Indietro 10 s", onClick = act { pc.seekBy(-10_000) })
                RoundButton(if (paused) Icons.Default.PlayArrow else Icons.Default.Pause, "Pausa", big = true, modifier = Modifier.focusRequester(playFocus), onClick = act { pc.togglePause() })
                RoundButton(Icons.Default.Forward10, "Avanti 10 s", onClick = act { pc.seekBy(10_000) })
                if (p is Playing.Ep) RoundButton(Icons.Default.SkipNext, "Episodio successivo", onClick = act { vm.playEpisodeOffset(+1) })
            }
        }
        RoundButton(Icons.Default.Subtitles, "Audio e sottotitoli", onClick = act(onTracks))
    }
}

@Composable
private fun RoundButton(icon: ImageVector, desc: String, big: Boolean = false, tint: Color = Color.White, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.tvClickable(shape = RoundedCornerShape(50), focusScale = 1.12f, background = Color(0x33FFFFFF), focusedBackground = C.Accent, onClick = onClick)
            .padding(if (big) 16.dp else 12.dp),
    ) { Icon(icon, desc, tint = tint, modifier = Modifier.size(if (big) 32.dp else 26.dp)) }
}

@Composable
private fun ChannelPanel(vm: AppViewModel, p: Playing.Live, close: () -> Unit) {
    val list = p.playlist
    val idx = list.indexOfFirst { it.streamId == p.channel.streamId }.coerceAtLeast(0)
    val state = rememberLazyListState(initialFirstVisibleItemIndex = maxOf(0, idx - 3))
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(50); runCatching { first.requestFocus() } }
    Column(Modifier.width(380.dp).fillMaxHeight().background(Color(0xF0111318)).safeDrawingPadding().padding(12.dp)) {
        Text("Canali", color = C.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(8.dp))
        LazyColumn(state = state, verticalArrangement = Arrangement.spacedBy(4.dp), contentPadding = PaddingValues(4.dp)) {
            itemsIndexed(list, key = { _, c -> c.streamId }) { i, ch ->
                val (now, _) = vm.epg.nowNext(ch)
                Row(
                    Modifier.fillMaxWidth().then(if (i == idx) Modifier.focusRequester(first) else Modifier)
                        .tvClickable(focusScale = 1.02f, background = if (i == idx) C.AccentSoft else Color.Transparent) {
                            vm.playChannel(ch, list); close()
                        }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Artwork(ch.logo, ch.initials, Modifier.size(width = 54.dp, height = 36.dp).clip(RoundedCornerShape(6.dp)), ContentScale.Fit, 12)
                    HSpace(10.dp)
                    Column(Modifier.weight(1f)) {
                        Text((if (ch.num > 0) "${ch.num}  " else "") + ch.name, color = C.Text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        now?.let { Text(it.title, color = C.Text2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TracksPanel(vm: AppViewModel, close: () -> Unit) {
    val pc = vm.player
    @Suppress("UNUSED_VARIABLE") val v = pc.tracksVersion
    val audio = pc.tracks(MC.TRACK_TYPE_AUDIO)
    val text = pc.tracks(MC.TRACK_TYPE_TEXT)
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(50); runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Color(0x99000000)).clickable(onClick = close), contentAlignment = Alignment.Center) {
        LazyColumn(
            Modifier.width(420.dp).clip(RoundedCornerShape(16.dp)).background(C.Panel).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            item { Text("Audio", color = C.Text2, fontWeight = FontWeight.Bold, modifier = Modifier.padding(6.dp)) }
            if (audio.isEmpty()) item { Text("Una sola traccia", color = C.Text3, modifier = Modifier.padding(6.dp)) }
            itemsIndexed(audio) { i, t ->
                TrackRow(t.label, t.selected, if (i == 0) Modifier.focusRequester(first) else Modifier) { pc.selectTrack(t); close() }
            }
            item { Text("Sottotitoli", color = C.Text2, fontWeight = FontWeight.Bold, modifier = Modifier.padding(6.dp, 14.dp, 6.dp, 6.dp)) }
            item { TrackRow("Disattivati", text.none { it.selected }, if (audio.isEmpty()) Modifier.focusRequester(first) else Modifier) { pc.disableSubtitles(); close() } }
            itemsIndexed(text) { _, t -> TrackRow(t.label, t.selected, Modifier) { pc.selectTrack(t); close() } }
        }
    }
}

@Composable
private fun TrackRow(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(modifier.fillMaxWidth().tvClickable(focusScale = 1.02f, background = if (selected) C.AccentSoft else Color.Transparent, onClick = onClick).padding(12.dp)) {
        Text(label, color = if (selected) C.Accent2 else C.Text, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun NextEpisodeCard(vm: AppViewModel, seconds: Int, modifier: Modifier) {
    val next = vm.nextEpisode() ?: return
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(modifier.safeDrawingPadding().padding(28.dp).width(360.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xEE111318)).padding(18.dp)) {
        Text("Prossimo episodio tra $seconds s", color = C.Text2, fontSize = 13.sp)
        Text("${next.label} · ${next.displayTitle}", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        VSpace(12.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionButton("Riproduci ora", Icons.Default.PlayArrow, primary = true, modifier = Modifier.focusRequester(focus)) { vm.playEpisodeOffset(+1) }
            ActionButton("Annulla", null) { vm.cancelCountdown(); vm.back() }
        }
    }
}

