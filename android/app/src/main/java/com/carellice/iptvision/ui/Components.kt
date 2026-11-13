package com.carellice.iptvision.ui

import android.content.pm.PackageManager
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.imageResource
import com.carellice.iptvision.R

/** Stile grafico scelto nelle impostazioni: cambia al volo colori e materiali di tutta l'app. */
object Skin {
    var skeuo by mutableStateOf(false)
}

/** Colori dell'app: quelli dello stile moderno o, con lo stile skeuomorfico, toni caldi di pelle e metallo. */
object C {
    private fun pick(classic: Long, skeuo: Long) = Color(if (Skin.skeuo) skeuo else classic)
    val Accent get() = pick(0xFF3D7BFF, 0xFF3D82F5)
    val Accent2 get() = pick(0xFF00C2FF, 0xFF6FB2FF)
    val Bg get() = pick(0xFF0A0B0F, 0xFF232529)
    val Panel get() = pick(0xFF111318, 0xFF2A2729)
    val Surface get() = pick(0xFF191C23, 0xFF34373E)
    val SurfaceHover get() = pick(0xFF21252E, 0xFF3E4149)
    val SurfacePressed get() = pick(0xFF2A2F3A, 0xFF464A54)
    val Stroke get() = pick(0xFF20242D, 0xFF0E0F11)
    val StrokeStrong get() = pick(0xFF2E3340, 0xFF0A0B0C)
    val Text get() = pick(0xFFF1F3F7, 0xFFF3F0E8)
    val Text2 get() = pick(0xFF9099A8, 0xFFABA69C)
    val Text3 get() = pick(0xFF5C6473, 0xFF7F7B72)
    val AccentSoft get() = pick(0x223D7BFF, 0x403D82F5)
    val Danger get() = pick(0xFFFF5D6C, 0xFFFF6B6B)
    val Star get() = pick(0xFFFFC94D, 0xFFFFCB45)
    val Live get() = pick(0xFFFF4D5E, 0xFFFF3B30)
}

/** Materiali dello stile skeuomorfico: lino, pelle, metallo spazzolato, plastica blu lucida, bordi in rilievo. */
object Skeuo {
    val Gloss = Brush.verticalGradient(
        0f to Color(0xFF8CC0FF), 0.48f to Color(0xFF4F94F8), 0.5f to Color(0xFF2A6EE6), 1f to Color(0xFF3C86F4),
    )
    val GlossEdge = Color(0xFF163E8C)
    /** Filo di luce in alto e ombra in basso: il bordo di una piastra in rilievo. */
    val Bevel = Brush.verticalGradient(0f to Color(0xFF70757F), 0.1f to Color(0xFF1A1B1F), 1f to Color(0xFF0A0B0C))
    /** Pozzetto incassato: scuro in alto, luce sul bordo inferiore. */
    val InsetEdge = Brush.verticalGradient(0f to Color(0xFF030304), 0.85f to Color(0xFF141518), 1f to Color(0xFF4A4D55))
    val Stitch = Color(0x73B8A78A)

    /** Piastra del colore dato: più chiara in alto, come illuminata dall'alto. */
    fun plate(c: Color): Brush = Brush.verticalGradient(listOf(lerp(c, Color.White, 0.07f), lerp(c, Color.Black, 0.18f)))

    @Composable
    fun texture(id: Int): Brush {
        val bmp = ImageBitmap.imageResource(id)
        return remember(bmp) { ShaderBrush(ImageShader(bmp, TileMode.Repeated, TileMode.Repeated)) }
    }
}

/**
 * Sfondo di schermate e pannelli: il colore nello stile moderno, il materiale in quello skeuomorfico
 * (lino per lo sfondo, pelle per i pannelli).
 */
@Composable
fun Modifier.material(color: Color): Modifier = when {
    !Skin.skeuo -> background(color)
    color == C.Bg -> background(color).background(Skeuo.texture(R.drawable.skeuo_linen))
    color == C.Panel -> background(color).background(Skeuo.texture(R.drawable.skeuo_leather))
    else -> background(color)
}

/** Barra di navigazione: metallo spazzolato con un filo di luce sul bordo. */
@Composable
fun Modifier.metalBar(): Modifier = if (!Skin.skeuo) background(C.Panel) else this
    .background(Color(0xFF40444C))
    .background(Skeuo.texture(R.drawable.skeuo_metal))
    .drawBehind { drawLine(Color(0x59FFFFFF), Offset(0f, 0f), Offset(size.width, 0f), 2f) }

private fun appColors(): ColorScheme = darkColorScheme(
    primary = C.Accent,
    onPrimary = Color.White,
    secondary = C.Accent2,
    background = C.Bg,
    onBackground = C.Text,
    surface = C.Surface,
    onSurface = C.Text,
    surfaceVariant = C.SurfaceHover,
    onSurfaceVariant = C.Text2,
    outline = C.StrokeStrong,
    error = C.Danger,
    surfaceContainer = C.Panel,
    surfaceContainerHigh = C.Surface,
    surfaceContainerHighest = C.SurfaceHover,
)

@Composable
fun IptvTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = appColors()) {
    if (!Skin.skeuo) content()
    // Testo inciso nel materiale: un'ombra scura sopra le lettere.
    else ProvideTextStyle(LocalTextStyle.current.copy(shadow = Shadow(Color(0xB3000000), Offset(0f, -2f), 0f)), content)
}

/**
 * Elemento cliccabile che si usa allo stesso modo col dito e col telecomando:
 * quando ha il focus si ingrandisce un poco e prende un bordo chiaro, come nella modalità TV di Windows.
 * Il tasto Menu del telecomando equivale alla pressione prolungata.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Modifier.tvClickable(
    shape: Shape = RoundedCornerShape(12.dp),
    focusScale: Float = 1.04f,
    background: Color = C.Surface,
    focusedBackground: Color = C.SurfacePressed,
    onLongClick: (() -> Unit)? = null,
    onFocus: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) focusScale else 1f, label = "focus")
    val fill = if (focused) focusedBackground else background
    val skeuo = Skin.skeuo && fill.alpha > 0.3f
    val gloss = skeuo && fill == C.Accent
    return this
        .scale(scale)
        .onFocusChanged {
            focused = it.isFocused
            if (it.isFocused) onFocus?.invoke()
        }
        .onPreviewKeyEvent { e ->
            if (onLongClick != null && e.type == KeyEventType.KeyUp && e.key == Key.Menu) { onLongClick(); true } else false
        }
        .then(if (skeuo) Modifier.shadow(3.dp, shape, clip = false) else Modifier)
        .clip(shape)
        .then(
            when {
                gloss -> Modifier.background(Skeuo.Gloss).border(1.dp, Skeuo.GlossEdge, shape)
                skeuo -> Modifier.background(Skeuo.plate(fill)).then(if (focused) Modifier else Modifier.border(1.dp, Skeuo.Bevel, shape))
                else -> Modifier.background(fill)
            },
        )
        .border(if (focused) 2.dp else 0.dp, if (focused) Color.White else Color.Transparent, shape)
        .combinedClickable(onLongClick = onLongClick, onClick = onClick)
}

/**
 * Sui campi di testo il telecomando resterebbe "intrappolato": ▲ e ▼ spostano il cursore e non il focus.
 * Qui li si usa per passare al campo o al pulsante vicino.
 */
@Composable
fun Modifier.dpadLeavable(): Modifier {
    val fm = LocalFocusManager.current
    return onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        when (e.key) {
            Key.DirectionDown -> fm.moveFocus(FocusDirection.Down)
            Key.DirectionUp -> fm.moveFocus(FocusDirection.Up)
            else -> false
        }
    }
}

/**
 * Griglie col telecomando: ▲ e ▼ li gestisce la griglia, per indice. La ricerca del focus di Compose
 * cercava il riquadro sotto solo tra quelli già pronti: se la riga dopo non lo era ancora, o col riquadro
 * ingrandito, il focus finiva a destra o tornava su. Uso: [rememberGridFocus], [dpadGrid] sulla griglia
 * e [gridItem] su ogni riquadro.
 */
class GridFocus {
    private val requesters = HashMap<Int, FocusRequester>()
    var focused = -1
    // Il riquadro chiesto e non ancora raggiunto: i tasti premuti in fretta partono da lì, non vanno persi.
    var pending = -1
    var started = false
    fun requester(i: Int) = requesters.getOrPut(i) { FocusRequester() }
}

@Composable
fun rememberGridFocus(key: Any?) = remember(key) { GridFocus() }

/** Il riquadro [i]; con [initial] prende il focus all'apertura, una volta sola e non a ogni ritorno in vista. */
@Composable
fun Modifier.gridItem(g: GridFocus, i: Int, initial: Boolean): Modifier {
    if (initial && !g.started) LaunchedEffect(Unit) {
        delay(80)
        g.started = true
        runCatching { g.requester(i).requestFocus() }
    }
    return focusRequester(g.requester(i)).onFocusChanged {
        if (it.isFocused) {
            g.focused = i
            if (g.pending == i) g.pending = -1
        }
    }
}

/** Tenendo premuto, le ripetizioni passano al massimo una ogni [gapMs] millisecondi, il tempo di scorrere. */
@Composable
fun Modifier.dpadGrid(state: LazyGridState, g: GridFocus, count: Int, gapMs: Long = 120): Modifier {
    val scope = rememberCoroutineScope()
    var last by remember { mutableLongStateOf(0L) }
    return onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown || (e.key != Key.DirectionDown && e.key != Key.DirectionUp)) return@onPreviewKeyEvent false
        val items = state.layoutInfo.visibleItemsInfo
        val from = if (g.pending in 0 until count) g.pending else g.focused
        if (from !in 0 until count || items.isEmpty()) return@onPreviewKeyEvent false
        val now = e.nativeKeyEvent.eventTime
        if (e.nativeKeyEvent.repeatCount > 0 && now - last < gapMs) return@onPreviewKeyEvent true
        last = now
        val cols = items.maxOf { it.column } + 1
        val down = e.key == Key.DirectionDown
        var to = if (down) from + cols else from - cols
        // Dalla prima riga si sale al resto della schermata; dall'ultima non si va oltre.
        if (to < 0) return@onPreviewKeyEvent false
        if (to >= count) {
            if (from / cols == (count - 1) / cols) return@onPreviewKeyEvent true
            to = count - 1
        }
        g.pending = to
        scope.launch {
            if (state.layoutInfo.visibleItemsInfo.none { it.index == to }) {
                // La riga non è ancora pronta: si scorre di una riga, o direttamente fin lì se è lontana.
                val step = items.first().size.height + state.layoutInfo.mainAxisItemSpacing
                state.scrollBy(if (down) step.toFloat() else -step.toFloat())
                if (state.layoutInfo.visibleItemsInfo.none { it.index == to }) state.scrollToItem(to)
            }
            repeat(3) {
                if (g.pending != to) return@launch // raggiunto, o già superato da un altro tasto
                runCatching { g.requester(to).requestFocus() }
                withFrameNanos { }
            }
            if (g.pending == to) g.pending = -1
        }
        true
    }
}

/**
 * Campo di testo col telecomando: ricevere il focus non apre la tastiera, che coprirebbe la schermata;
 * si apre premendo OK e si richiude passando a un altro elemento. Sul telefono si scrive come sempre.
 * Uso: `readOnly = !t.editing` e `Modifier.tvTyping(t)` sul campo.
 */
class TvTyping(val tv: Boolean) {
    var editing by mutableStateOf(!tv)
}

@Composable
fun rememberTvTyping(): TvTyping {
    val context = LocalContext.current
    val t = remember { TvTyping(context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(t.editing) { if (t.tv && t.editing) keyboard?.show() }
    return t
}

fun Modifier.tvTyping(t: TvTyping): Modifier = if (!t.tv) this else this
    .onFocusChanged { if (!it.isFocused) t.editing = false }
    .onPreviewKeyEvent { e ->
        val ok = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
        if (!t.editing && ok) {
            if (e.type == KeyEventType.KeyUp) t.editing = true
            true
        } else false
    }

/** Immagine remota con le iniziali come segnaposto (loghi dei canali, locandine). */
@Composable
fun Artwork(url: String?, initials: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop, fontSize: Int = 18) {
    Box(modifier.background(C.SurfaceHover), contentAlignment = Alignment.Center) {
        if (url.isNullOrBlank()) {
            Initials(initials, fontSize)
        } else {
            // AsyncImage e non SubcomposeAsyncImage: senza una sottocomposizione per ogni locandina le
            // liste di migliaia di film scorrono fluide. Le iniziali restano finché l'immagine non c'è.
            var shown by remember(url) { mutableStateOf(false) }
            if (!shown) Initials(initials, fontSize)
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.fillMaxSize(),
                onSuccess = { shown = true },
                onError = { shown = false },
            )
        }
    }
}

@Composable
private fun Initials(text: String, fontSize: Int) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = C.Text2, fontWeight = FontWeight.Bold, fontSize = fontSize.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun ProgressLine(progress: Float, modifier: Modifier = Modifier, color: Color = C.Accent, height: Dp = 3.dp) {
    Box(modifier.height(height).clip(RoundedCornerShape(2.dp)).background(C.StrokeStrong)) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(height).background(color))
    }
}

@Composable
fun Pill(text: String, selected: Boolean, icon: ImageVector? = null, modifier: Modifier = Modifier, onFocus: (() -> Unit)? = null, onClick: () -> Unit) {
    Row(
        modifier
            .tvClickable(
                shape = RoundedCornerShape(50),
                background = if (selected) C.Accent else C.Surface,
                focusedBackground = if (selected) C.Accent else C.SurfacePressed,
                onFocus = onFocus,
                onClick = onClick,
            )
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = if (selected) Color.White else C.Text2, modifier = Modifier.size(18.dp))
        Text(text, color = if (selected) Color.White else C.Text, fontSize = 14.sp, maxLines = 1, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ActionButton(text: String, icon: ImageVector?, primary: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .tvClickable(
                shape = RoundedCornerShape(10.dp),
                background = if (primary) C.Accent else C.Surface,
                focusedBackground = if (primary) Color(0xFF5A90FF) else C.SurfacePressed,
                onClick = onClick,
            )
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
        Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

@Composable
fun Loading(text: String? = null, modifier: Modifier = Modifier.fillMaxSize()) {
    Column(modifier, verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = C.Accent)
        if (text != null) {
            Spacer(Modifier.height(14.dp))
            Text(text, color = C.Text2)
        }
    }
}

/**
 * Il primo download di una lista grande: una barra che si riempie se il server dice quanto pesa,
 * altrimenti scorre, con i megabyte già arrivati. Arrivato tutto, la lista si prepara.
 */
@Composable
fun DownloadProgress(title: String, progress: Pair<Long, Long>?, modifier: Modifier = Modifier.fillMaxSize()) {
    if (progress == null) { Loading(title, modifier); return }
    val (read, total) = progress
    Column(modifier.padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = C.Text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(16.dp))
        val bar = Modifier.widthIn(max = 360.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp))
        if (total > 0) {
            LinearProgressIndicator(progress = { (read.toFloat() / total).coerceIn(0f, 1f) }, modifier = bar, color = C.Accent, trackColor = C.Accent.copy(alpha = 0.2f))
        } else {
            LinearProgressIndicator(modifier = bar, color = C.Accent, trackColor = C.Accent.copy(alpha = 0.2f))
        }
        Spacer(Modifier.height(12.dp))
        val mb = { b: Long -> String.format(java.util.Locale.ITALY, "%.1f MB", b / 1_048_576.0) }
        Text(
            when {
                total > 0 && read >= total -> "Preparazione dell'elenco…"
                total > 0 -> "${(read * 100 / total).toInt()}% · ${mb(read)} di ${mb(total)}"
                else -> "${mb(read)} scaricati"
            },
            color = C.Text2, fontSize = 13.sp,
        )
        Spacer(Modifier.height(6.dp))
        Text("Solo la prima volta: poi la lista si apre subito.", color = C.Text3, fontSize = 12.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun Empty(text: String, modifier: Modifier = Modifier.fillMaxSize()) {
    Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, color = C.Text2, textAlign = TextAlign.Center)
    }
}

@Composable
fun SectionTitle(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(title, color = C.Text, fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (subtitle != null) Text(subtitle, color = C.Text2, fontSize = 13.sp)
    }
}

@Composable
fun Badge(text: String, color: Color = C.SurfacePressed) {
    Text(
        text,
        color = C.Text,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(color).padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
fun HSpace(w: Dp) = Spacer(Modifier.width(w))

@Composable
fun VSpace(h: Dp) = Spacer(Modifier.height(h))
