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
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.core.spring
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.draw.alpha

/** Stile grafico scelto nelle impostazioni: cambia al volo colori e materiali di tutta l'app. */
object Skin {
    var skeuo by mutableStateOf(false)
    /** Modern UI (Windows Phone): nero, piatto, angoli vivi, sezioni come voci del pivot (HomeScreen). */
    var metro by mutableStateOf(false)
    /** Dueffe: fondo quasi nero, superfici calde, avorio e oro, Bricolage e Inter, pressione a molla. */
    var dueffe by mutableStateOf(false)
    /** Nothing: nero OLED a punti, superfici piatte con linee sottili, bianco e un solo rosso, Space Grotesk, Space Mono e Doto. */
    var nothing by mutableStateOf(false)

    fun set(skin: String) {
        skeuo = skin == "skeuo"
        metro = skin == "metro"
        dueffe = skin == "dueffe"
        nothing = skin == "nothing"
    }
}

/** Colori dell'app: quelli dello stile moderno o, con lo stile skeuomorfico, toni caldi di pelle e metallo. */
object C {
    private fun pick(classic: Long, skeuo: Long, metro: Long, dueffe: Long, nothing: Long) =
        Color(if (Skin.nothing) nothing else if (Skin.dueffe) dueffe else if (Skin.metro) metro else if (Skin.skeuo) skeuo else classic)
    val Accent get() = pick(0xFF3D7BFF, 0xFF3D82F5, 0xFF1BA1E2, 0xFFFFD84D, 0xFFFFFFFF)
    val Accent2 get() = pick(0xFF00C2FF, 0xFF6FB2FF, 0xFF1BA1E2, 0xFFFFB800, 0xFFE8E8E8)
    val Bg get() = pick(0xFF0A0B0F, 0xFF232529, 0xFF000000, 0xFF050505, 0xFF000000)
    val Panel get() = pick(0xFF111318, 0xFF2A2729, 0xFF1F1F1F, 0xFF0B0A08, 0xFF000000)
    val Surface get() = pick(0xFF191C23, 0xFF34373E, 0xFF1F1F1F, 0xFF1A1711, 0xFF111111)
    val SurfaceHover get() = pick(0xFF21252E, 0xFF3E4149, 0xFF2B2B2B, 0xFF242016, 0xFF1A1A1A)
    val SurfacePressed get() = pick(0xFF2A2F3A, 0xFF464A54, 0xFF1BA1E2, 0xFF2E281A, 0xFF222222)
    val Stroke get() = pick(0xFF20242D, 0xFF0E0F11, 0xFF262626, 0x29FFDC80, 0xFF222222)
    val StrokeStrong get() = pick(0xFF2E3340, 0xFF0A0B0C, 0xFF3D3D3D, 0x57FFD84D, 0xFF333333)
    val Text get() = pick(0xFFF1F3F7, 0xFFF3F0E8, 0xFFFFFFFF, 0xFFFFFAF0, 0xFFE8E8E8)
    val Text2 get() = pick(0xFF9099A8, 0xFFABA69C, 0xFFA6A6A6, 0xFFB8AA8D, 0xFF999999)
    val Text3 get() = pick(0xFF5C6473, 0xFF7F7B72, 0xFF6B6B6B, 0xFF7E7461, 0xFF666666)
    val AccentSoft get() = pick(0x223D7BFF, 0x403D82F5, 0xFF1BA1E2, 0x24FFD84D, 0x14FFFFFF)
    val Danger get() = pick(0xFFFF5D6C, 0xFFFF6B6B, 0xFFE51400, 0xFFFF9B85, 0xFFD71921)
    val Star get() = pick(0xFFFFC94D, 0xFFFFCB45, 0xFFF0A30A, 0xFFFFD84D, 0xFFFFFFFF)
    val Live get() = pick(0xFFFF4D5E, 0xFFFF3B30, 0xFFE51400, 0xFFFF7A5C, 0xFFD71921)
    /** Testo e icone sopra l'accento: scuri sull'oro di Dueffe e sul bianco di Nothing, bianchi altrove. */
    val OnAccent get() = pick(0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFF161006, 0xFF000000)
}

/** Design system Dueffe: font, gradienti oro, card calde con bordo sottile, aurora sul fondo. */
object Dueffe {
    val Line = Color(0x29FFDC80)
    val Nav = Color(0xF0080705)
    val Gold = Brush.linearGradient(listOf(Color(0xFFFFD84D), Color(0xFFFFC21A)))
    val Card = Brush.verticalGradient(listOf(Color(0xFF1A1711), Color(0xFF11100D)))

    @OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
    private fun font(id: Int, w: Int) = androidx.compose.ui.text.font.Font(
        id, FontWeight(w),
        variationSettings = androidx.compose.ui.text.font.FontVariation.Settings(androidx.compose.ui.text.font.FontVariation.weight(w)),
    )
    val Display = androidx.compose.ui.text.font.FontFamily(listOf(400, 500, 600, 700, 800).map { font(R.font.bricolage, it) })
    val Body = androidx.compose.ui.text.font.FontFamily(listOf(400, 500, 600, 700).map { font(R.font.inter, it) })

    /** Raggi del design system: tasti 18, card 20, pillole tonde. */
    fun corners(shape: Shape): Shape = when (shape) {
        RoundedCornerShape(10.dp), RoundedCornerShape(14.dp) -> RoundedCornerShape(18.dp)
        RoundedCornerShape(12.dp) -> RoundedCornerShape(20.dp)
        else -> shape
    }

    /** Aurora ferma: tre nebulose oro e ambra sul fondo quasi nero. */
    fun Modifier.aurora(): Modifier = drawBehind {
        val w = size.width; val h = size.height; val r = maxOf(w, h)
        drawRect(Brush.radialGradient(listOf(Color(0x2EFFD84D), Color.Transparent), Offset(w * 0.1f, h * 0.02f), r * 0.55f))
        drawRect(Brush.radialGradient(listOf(Color(0x24FFB800), Color.Transparent), Offset(w * 0.95f, h * 0.35f), r * 0.5f))
        drawRect(Brush.radialGradient(listOf(Color(0x1AFFF0AD), Color.Transparent), Offset(w * 0.4f, h * 1.05f), r * 0.6f))
    }
}

/** Design system Nothing: font, griglia di punti sul fondo, raggi (pillole per i tasti, 12-16 per le card). */
object Nothing {
    @OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
    private fun font(id: Int, w: Int) = androidx.compose.ui.text.font.Font(
        id, FontWeight(w),
        variationSettings = androidx.compose.ui.text.font.FontVariation.Settings(androidx.compose.ui.text.font.FontVariation.weight(w)),
    )
    val Body = androidx.compose.ui.text.font.FontFamily(listOf(300, 400, 500, 600, 700).map { font(R.font.nd_grotesk, it) })
    val Mono = androidx.compose.ui.text.font.FontFamily(androidx.compose.ui.text.font.Font(R.font.nd_mono))
    val Dots = androidx.compose.ui.text.font.FontFamily(androidx.compose.ui.text.font.Font(R.font.nd_doto, FontWeight.Bold))

    /** Tasti e pillole tondi, card al massimo 16. */
    fun corners(shape: Shape): Shape = when (shape) {
        RoundedCornerShape(10.dp), RoundedCornerShape(14.dp) -> RoundedCornerShape(50)
        else -> shape
    }

    /** Griglia di punti da 16 dp appena visibile, il motivo a matrice di punti di Nothing. */
    fun Modifier.dots(): Modifier = drawBehind {
        val step = 16.dp.toPx(); val r = 0.75.dp.toPx(); val c = Color(0x1FFFFFFF)
        var y = step / 2
        while (y < size.height) {
            var x = step / 2
            while (x < size.width) { drawCircle(c, r, Offset(x, y)); x += step }
            y += step
        }
    }
}

/** Angoli arrotondati, o vivi nello stile Modern UI. */
fun skinCorners(r: Dp): Shape = if (Skin.metro) RectangleShape else if (Skin.dueffe) RoundedCornerShape(r * 1.5f) else RoundedCornerShape(r)

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
    Skin.dueffe && color == C.Bg -> with(Dueffe) { background(color).aurora() }
    Skin.nothing && color == C.Bg -> with(Nothing) { background(color).dots() }
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
    onPrimary = C.OnAccent,
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
    if (Skin.dueffe) ProvideTextStyle(LocalTextStyle.current.copy(fontFamily = Dueffe.Body, letterSpacing = 0.sp), content)
    else if (Skin.nothing) ProvideTextStyle(LocalTextStyle.current.copy(fontFamily = Nothing.Body, letterSpacing = 0.sp), content)
    else if (!Skin.skeuo) content()
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
    // Dueffe: premuto si comprime, al rilascio rimbalza a molla (al posto del ripple).
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (Skin.dueffe && pressed) 0.95f else if (focused && !Skin.nothing) focusScale else 1f,
        if (Skin.dueffe) spring(if (pressed) 1f else 0.42f, if (pressed) 900f else 380f) else spring(),
        label = "focus",
    )
    // Modern UI: angoli vivi (i cerchi restano); pulsanti e pillole sul fondo scuro col bordo bianco, righe e schede piatte.
    val metroButton = Skin.metro && background == C.Surface && (shape == RoundedCornerShape(10.dp) || shape == RoundedCornerShape(50))
    // === e non ==: CircleShape è uguale a RoundedCornerShape(50), e le pillole devono diventare rettangoli.
    val keepRound = shape === CircleShape || (shape == RoundedCornerShape(50) && background != C.Surface && background != C.Accent)
    val shape = if (Skin.metro && !keepRound) RectangleShape else if (Skin.dueffe) Dueffe.corners(shape) else if (Skin.nothing) Nothing.corners(shape) else shape
    // Nothing: tasti e pillole secondari sono solo un contorno, le card #111 con un filo #222; niente molla, premuto sbiadisce.
    val ndOutline = Skin.nothing && background == C.Surface && shape == RoundedCornerShape(50)
    val background = if ((Skin.metro || ndOutline) && background == C.Surface) Color.Transparent else background
    val ndAlpha by animateFloatAsState(if (Skin.nothing && pressed) 0.6f else 1f, androidx.compose.animation.core.tween(180), label = "press")
    val fill = if (focused) focusedBackground else background
    // Dueffe: l'oro è un gradiente, le superfici sono card calde con un filo di bordo; il focus è oro.
    val dfGold = Skin.dueffe && fill == C.Accent
    val dfCard = Skin.dueffe && fill.alpha > 0.5f && !dfGold
    val skeuo = Skin.skeuo && fill.alpha > 0.3f
    val gloss = skeuo && fill == C.Accent
    return this
        .scale(scale)
        .alpha(ndAlpha)
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
                dfGold -> Modifier.background(Dueffe.Gold)
                dfCard && fill == C.Surface -> Modifier.background(Dueffe.Card).border(1.dp, Dueffe.Line, shape)
                dfCard -> Modifier.background(fill).border(1.dp, Dueffe.Line, shape)
                gloss -> Modifier.background(Skeuo.Gloss).border(1.dp, Skeuo.GlossEdge, shape)
                skeuo -> Modifier.background(Skeuo.plate(fill)).then(if (focused) Modifier else Modifier.border(1.dp, Skeuo.Bevel, shape))
                Skin.nothing && ndOutline && !focused -> Modifier.border(1.dp, C.StrokeStrong, shape)
                Skin.nothing && fill.alpha > 0.5f && fill != C.Accent && !focused -> Modifier.background(fill).border(1.dp, C.Stroke, shape)
                else -> Modifier.background(fill)
            },
        )
        .then(if (metroButton && !focused) Modifier.border(2.dp, Color.White, shape) else Modifier)
        .border(
            if (focused) (if (Skin.nothing) 1.5.dp else 2.dp) else 0.dp,
            if (!focused) Color.Transparent else if (dfGold) C.Text else if (Skin.dueffe) C.Accent else if (Skin.nothing && fill == C.Accent) C.Live else Color.White,
            shape,
        )
        .then(
            if (Skin.dueffe || Skin.nothing) Modifier.combinedClickable(interactionSource = source, indication = null, onLongClick = onLongClick, onClick = onClick)
            else Modifier.combinedClickable(onLongClick = onLongClick, onClick = onClick),
        )
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
    if (Skin.nothing) {
        // Nothing: barra a segmenti quadrati, blocchi da 6 dp con 2 dp di stacco.
        val h = maxOf(height, 4.dp)
        Box(modifier.height(h).drawBehind {
            val seg = 6.dp.toPx(); val gap = 2.dp.toPx(); val filled = size.width * progress.coerceIn(0f, 1f)
            var x = 0f
            while (x < size.width) {
                val w = minOf(seg, size.width - x)
                drawRect(if (x < filled) color else Color(0xFF222222), Offset(x, 0f), androidx.compose.ui.geometry.Size(w, size.height))
                x += seg + gap
            }
        })
        return
    }
    Box(modifier.height(height).clip(if (Skin.metro) RectangleShape else RoundedCornerShape(50)).background(if (Skin.dueffe) C.SurfaceHover else C.StrokeStrong)) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(height).background(color))
    }
}

/** Etichetta Nothing di tasti e pillole: Space Mono maiuscolo, 13 sp, spaziatura larga. */
@Composable
fun NdLabel(text: String, color: Color) =
    Text(text.uppercase(), color = color, fontSize = 13.sp, maxLines = 1, fontFamily = Nothing.Mono, letterSpacing = 0.8.sp)

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
        if (icon != null) Icon(icon, null, tint = if (selected) C.OnAccent else C.Text2, modifier = Modifier.size(18.dp))
        if (Skin.nothing) NdLabel(text, if (selected) C.OnAccent else C.Text)
        else Text(text, color = if (selected) C.OnAccent else C.Text, fontSize = 14.sp, maxLines = 1, fontWeight = if (Skin.dueffe) FontWeight.SemiBold else FontWeight.Medium)
    }
}

@Composable
fun ActionButton(text: String, icon: ImageVector?, primary: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .tvClickable(
                shape = RoundedCornerShape(10.dp),
                background = if (primary) C.Accent else C.Surface,
                focusedBackground = if (primary) (if (Skin.dueffe) C.Accent else Color(0xFF5A90FF)) else C.SurfacePressed,
                onClick = onClick,
            )
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val on = if (primary) C.OnAccent else if (Skin.dueffe || Skin.nothing) C.Text else Color.White
        if (icon != null) Icon(icon, null, tint = on, modifier = Modifier.size(20.dp))
        if (Skin.nothing) NdLabel(text, on) else Text(text, color = on, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
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
        // Modern UI: il pivot in alto nomina già la sezione, resta il sottotitolo.
        // Nothing: titolo a matrice di punti (Doto) e sottotitolo come etichetta Space Mono.
        if (Skin.nothing) {
            Text(title, color = Color.White, fontSize = 36.sp, lineHeight = 40.sp, fontFamily = Nothing.Dots, fontWeight = FontWeight.Bold, maxLines = 1,
                overflow = TextOverflow.Ellipsis, letterSpacing = (-0.5).sp)
            if (subtitle != null) Text(subtitle.uppercase(), color = C.Text2, fontSize = 11.sp, fontFamily = Nothing.Mono, letterSpacing = 0.9.sp,
                modifier = Modifier.padding(top = 4.dp))
            return@Column
        }
        if (!(Skin.metro && com.carellice.iptvision.Section.entries.any { it.title == title })) Text(
            title, color = C.Text, fontSize = if (Skin.dueffe) 30.sp else 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            fontFamily = if (Skin.dueffe) Dueffe.Display else null, letterSpacing = if (Skin.dueffe) (-0.3).sp else TextUnit.Unspecified,
        )
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
        modifier = Modifier.clip(if (Skin.metro) RectangleShape else RoundedCornerShape(4.dp)).background(color).padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
fun HSpace(w: Dp) = Spacer(Modifier.width(w))

@Composable
fun VSpace(h: Dp) = Spacer(Modifier.height(h))
