package com.carellice.iptvision.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.Section
import com.carellice.iptvision.data.Downloads
import java.util.Locale

fun formatBytes(b: Long): String = when {
    b >= 1L shl 30 -> String.format(Locale.ITALY, "%.1f GB", b / (1L shl 30).toDouble())
    b >= 1L shl 20 -> String.format(Locale.ITALY, "%.0f MB", b / (1L shl 20).toDouble())
    else -> String.format(Locale.ITALY, "%.0f KB", b / 1024.0)
}

/** Film ed episodi scaricati, quelli in corso e quelli in coda. */
@Composable
fun DownloadsSection(vm: AppViewModel) {
    @Suppress("UNUSED_VARIABLE") val pv = vm.positionsVersion
    val d = vm.downloads
    val items = d.items
    // In corso e in coda in cima, poi film e serie in ordine alfabetico (gli episodi in ordine).
    val ordered = remember(items) {
        items.sortedWith(compareBy<Downloads.Item>(
            { if (it.state == Downloads.State.Done) 1 else 0 },
            { (it.seriesName ?: it.title).lowercase() }, { it.season }, { it.number },
        ))
    }
    var confirm by remember { mutableStateOf<Downloads.Item?>(null) }

    SectionTitle("Download", "${items.count { it.state == Downloads.State.Done }} scaricati · ${formatBytes(d.usedBytes())} occupati · ${formatBytes(d.freeBytes())} liberi")
    if (items.isEmpty()) {
        Empty("Nessun download. Apri un film o una serie e premi Scarica: potrai guardarli anche senza connessione.")
        return
    }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
        items(ordered, key = { it.key }) { item ->
            DownloadRow(vm, item, onDelete = { confirm = item })
        }
    }

    confirm?.let { item ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = C.Panel,
            title = { Text(if (item.state == Downloads.State.Done) "Eliminare il download?" else "Annullare il download?", color = C.Text) },
            text = { Text(item.title, color = C.Text2) },
            confirmButton = { TextButton(onClick = { d.remove(item.key); confirm = null }) { Text(if (item.state == Downloads.State.Done) "Elimina" else "Annulla download", color = C.Danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Indietro", color = C.Text2) } },
        )
    }
}

@Composable
private fun DownloadRow(vm: AppViewModel, item: Downloads.Item, onDelete: () -> Unit) {
    val done = item.state == Downloads.State.Done
    val watched = vm.positions.progress(item.key)
    Row(
        Modifier.fillMaxWidth().tvClickable(focusScale = 1.01f) { if (done) vm.playDownload(item) else if (item.state == Downloads.State.Failed) vm.downloads.retry(item.key) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Artwork(item.image, item.title.take(2).uppercase(), Modifier.width(if (item.isEpisode) 110.dp else 62.dp).aspectRatio(if (item.isEpisode) 16f / 9f else 2f / 3f).clip(RoundedCornerShape(8.dp)), fontSize = 14)
            if (watched > 0f && watched < 1f) ProgressLine(watched, Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(4.dp))
        }
        HSpace(14.dp)
        Column(Modifier.weight(1f)) {
            Text(item.seriesName ?: item.title, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (item.isEpisode) Text("S${item.season} E${item.number} · ${item.episodeTitle ?: ""}", color = C.Text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            VSpace(4.dp)
            when (item.state) {
                Downloads.State.Done -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.DownloadDone, null, tint = C.Accent, modifier = Modifier.size(15.dp))
                    HSpace(5.dp)
                    Text(formatBytes(item.total) + if (watched >= 1f) " · visto" else "", color = C.Text3, fontSize = 12.sp)
                }
                Downloads.State.Running -> Column {
                    ProgressLine(item.progress, Modifier.fillMaxWidth().padding(vertical = 3.dp))
                    Text(if (item.total > 0) "${(item.progress * 100).toInt()}% · ${formatBytes(item.bytes)} di ${formatBytes(item.total)}" else "Avvio…", color = C.Text3, fontSize = 12.sp)
                }
                Downloads.State.Queued -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Schedule, null, tint = C.Text3, modifier = Modifier.size(15.dp))
                    HSpace(5.dp)
                    Text(if (vm.downloads.wifiOnly) "In coda (in attesa del Wi-Fi se serve)" else "In coda", color = C.Text3, fontSize = 12.sp)
                }
                Downloads.State.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.ErrorOutline, null, tint = C.Danger, modifier = Modifier.size(15.dp))
                    HSpace(5.dp)
                    Text((item.error ?: "Non riuscito") + " · tocca per riprovare", color = C.Danger, fontSize = 12.sp)
                }
            }
        }
        if (item.state == Downloads.State.Failed) IconButton(onClick = { vm.downloads.retry(item.key) }) { Icon(Icons.Default.Refresh, "Riprova", tint = C.Text2) }
        IconButton(onClick = onDelete) { Icon(if (done) Icons.Default.Delete else Icons.Default.Close, if (done) "Elimina" else "Annulla", tint = C.Text2) }
    }
}

/** Pulsante Scarica / avanzamento / Scaricato per film ed episodi. */
@Composable
fun DownloadButton(vm: AppViewModel, key: String, compact: Boolean = false, onDownload: () -> Unit) {
    val item = vm.downloads.items.firstOrNull { it.key == key }
    val (label, icon) = when (item?.state) {
        null -> "Scarica" to Icons.Default.Download
        Downloads.State.Queued -> "In coda" to Icons.Default.Schedule
        Downloads.State.Running -> (if (item.total > 0) "${(item.progress * 100).toInt()}%" else "Avvio…") to Icons.Default.Download
        Downloads.State.Done -> "Scaricato" to Icons.Default.DownloadDone
        Downloads.State.Failed -> "Riprova" to Icons.Default.Refresh
    }
    val action = {
        when (item?.state) {
            null -> onDownload()
            Downloads.State.Failed -> vm.downloads.retry(key)
            // In corso o finito: si gestisce dalla sezione Download.
            else -> { vm.backToHome(); vm.section = Section.Downloads }
        }
    }
    if (compact) {
        IconButton(onClick = action) {
            if (item?.state == Downloads.State.Running && item.total > 0) {
                androidx.compose.material3.CircularProgressIndicator(progress = { item.progress }, color = C.Accent, trackColor = C.StrokeStrong, strokeWidth = 3.dp, modifier = Modifier.size(22.dp))
            } else Icon(icon, label, tint = if (item?.state == Downloads.State.Done) C.Accent else C.Text2)
        }
    } else ActionButton(label, icon, onClick = action)
}
