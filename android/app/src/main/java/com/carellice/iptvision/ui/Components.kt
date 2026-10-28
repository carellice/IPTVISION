package com.carellice.iptvision.ui

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import coil.compose.SubcomposeAsyncImage

object C {
    val Accent = Color(0xFF3D7BFF)
    val Accent2 = Color(0xFF00C2FF)
    val Bg = Color(0xFF0A0B0F)
    val Panel = Color(0xFF111318)
    val Surface = Color(0xFF191C23)
    val SurfaceHover = Color(0xFF21252E)
    val SurfacePressed = Color(0xFF2A2F3A)
    val Stroke = Color(0xFF20242D)
    val StrokeStrong = Color(0xFF2E3340)
    val Text = Color(0xFFF1F3F7)
    val Text2 = Color(0xFF9099A8)
    val Text3 = Color(0xFF5C6473)
    val AccentSoft = Color(0x223D7BFF)
    val Danger = Color(0xFFFF5D6C)
    val Star = Color(0xFFFFC94D)
    val Live = Color(0xFFFF4D5E)
}

val AppColors: ColorScheme = darkColorScheme(
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
fun IptvTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = AppColors, content = content)

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
    return this
        .scale(scale)
        .onFocusChanged {
            focused = it.isFocused
            if (it.isFocused) onFocus?.invoke()
        }
        .onPreviewKeyEvent { e ->
            if (onLongClick != null && e.type == KeyEventType.KeyUp && e.key == Key.Menu) { onLongClick(); true } else false
        }
        .clip(shape)
        .background(if (focused) focusedBackground else background)
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

/** Immagine remota con le iniziali come segnaposto (loghi dei canali, locandine). */
@Composable
fun Artwork(url: String?, initials: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop, fontSize: Int = 18) {
    Box(modifier.background(C.SurfaceHover), contentAlignment = Alignment.Center) {
        if (url.isNullOrBlank()) {
            Initials(initials, fontSize)
        } else {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.fillMaxSize(),
                loading = { Initials(initials, fontSize) },
                error = { Initials(initials, fontSize) },
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
