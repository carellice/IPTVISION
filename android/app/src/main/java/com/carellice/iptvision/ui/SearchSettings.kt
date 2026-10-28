package com.carellice.iptvision.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.data.UpdateService

// ---------- Ricerca unica: canali, film e serie insieme ----------

@Composable
fun SearchSection(vm: AppViewModel, onVoiceSearch: () -> Unit) {
    val q = vm.searchQuery
    val results = remember(q, vm.live, vm.movies, vm.series) { vm.search(q) }
    Column(Modifier.fillMaxSize()) {
        SectionTitle("Cerca", if (q.isBlank()) "Canali, film e serie insieme" else "${results.total} risultati")
        VSpace(12.dp)
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = q,
                onValueChange = vm::setQuery,
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null, tint = C.Text2) },
                trailingIcon = if (q.isNotEmpty()) { { IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Default.Close, "Cancella", tint = C.Text2) } } } else null,
                placeholder = { Text("Nome del canale, del film o della serie", color = C.Text3) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = C.Accent, unfocusedBorderColor = C.StrokeStrong,
                    focusedContainerColor = C.Panel, unfocusedContainerColor = C.Panel,
                ),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.weight(1f).dpadLeavable(),
            )
            HSpace(10.dp)
            Row(
                Modifier.tvClickable(shape = RoundedCornerShape(14.dp), background = C.AccentSoft, onClick = onVoiceSearch).padding(16.dp),
            ) { Icon(Icons.Default.Mic, "Ricerca vocale", tint = C.Accent) }
        }
        VSpace(10.dp)
        if (vm.moviesLoading || vm.seriesLoading) Text("Carico anche film e serie…", color = C.Text3, fontSize = 12.sp)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp)) {
            if (results.channels.isNotEmpty()) {
                item { Header("Canali", results.channels.size) }
                items(results.channels, key = { "c${it.streamId}" }) { ch -> ChannelRow(vm, ch, results.channels, false) }
            }
            if (results.movies.isNotEmpty()) {
                item { Header("Film", results.movies.size) }
                items(results.movies, key = { "m${it.streamId}" }) { m ->
                    Hit(m.name, m.meta, "Film", m.poster, m.initials) { vm.openMovie(m) }
                }
            }
            if (results.series.isNotEmpty()) {
                item { Header("Serie TV", results.series.size) }
                items(results.series, key = { "s${it.seriesId}" }) { s ->
                    Hit(s.name, s.meta, "Serie", s.cover, s.initials) { vm.openSeries(s) }
                }
            }
            if (q.isNotBlank() && results.total == 0 && !vm.moviesLoading && !vm.seriesLoading) item { Empty("Nessun risultato per \"$q\".") }
        }
    }
}

@Composable
private fun Header(title: String, count: Int) {
    Text("$title · $count", color = C.Text2, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
}

@Composable
private fun Hit(title: String, meta: String, kind: String, url: String?, initials: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().tvClickable(focusScale = 1.02f, onClick = onClick).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(url, initials, Modifier.size(width = 48.dp, height = 72.dp).clip(RoundedCornerShape(6.dp)), ContentScale.Crop, 14)
        HSpace(12.dp)
        Column(Modifier.weight(1f)) {
            Text(title, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            VSpace(4.dp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(kind)
                if (meta.isNotEmpty()) { HSpace(8.dp); Text(meta, color = C.Text2, fontSize = 12.sp, maxLines = 1) }
            }
        }
    }
}

// ---------- Impostazioni ----------

@Composable
fun SettingsSection(vm: AppViewModel) {
    @Suppress("UNUSED_VARIABLE") val sv = vm.settingsVersion // le preferenze non sono osservabili: si ridisegna a ogni modifica
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).widthIn(max = 760.dp)) {
        SectionTitle("Impostazioni")
        VSpace(16.dp)

        Group("Account")
        Info("Server", vm.settings.server ?: "")
        Info("Utente", vm.settings.username ?: "")

        Group("Riproduzione")
        Toggle("Formato HLS (m3u8) per la TV in diretta", "Di solito MPEG-TS è più stabile; prova HLS se un canale non parte.", vm.settings.outputFormat == "m3u8") {
            vm.settings.outputFormat = if (it) "m3u8" else "ts"
            vm.refreshUi()
        }
        Toggle("Riprendi l'ultimo canale all'avvio", "Apri l'app e il canale riparte da dov'eri rimasto.", vm.settings.autoPlayLastChannel) {
            vm.settings.autoPlayLastChannel = it
            vm.refreshUi()
        }

        Group("Dati")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            ActionButton("Aggiorna liste e guida", Icons.Default.Refresh) { vm.refreshAll() }
            ActionButton("Svuota cache", Icons.Default.Delete) { vm.clearCache() }
        }

        Group("Aggiornamenti")
        Info("Versione installata", UpdateService.currentVersion)
        Toggle("Controlla aggiornamenti all'avvio", null, vm.settings.autoCheckUpdates) {
            vm.settings.autoCheckUpdates = it
            vm.refreshUi()
        }
        val u = vm.update
        if (u != null) {
            Text("Disponibile IPTVISION ${u.version}", color = C.Accent2, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
            if (u.notes.isNotBlank()) Text(u.notes.substringBefore("\n---").take(800), color = C.Text2, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        }
        vm.updateProgress?.let { p ->
            LinearProgressIndicator(progress = { p }, color = C.Accent, trackColor = C.StrokeStrong, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
            Text("Download ${(p * 100).toInt()}%", color = C.Text2, fontSize = 12.sp)
        }
        vm.updateMessage?.let { Text(it, color = C.Text2, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp)) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            if (u != null) ActionButton("Aggiorna a ${u.version}", Icons.Default.SystemUpdate, primary = true) { vm.installUpdate() }
            else ActionButton("Controlla ora", Icons.Default.SystemUpdate) { vm.checkUpdates(silent = false) }
        }

        Group("")
        ActionButton("Esci dall'account", Icons.Default.Logout, modifier = Modifier.padding(vertical = 6.dp)) { vm.logout() }
        VSpace(8.dp)
        Text(
            "IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.",
            color = C.Text3, fontSize = 12.sp,
        )
        VSpace(24.dp)
    }
}

@Composable
private fun Group(title: String) {
    VSpace(18.dp)
    if (title.isNotEmpty()) Text(title.uppercase(), color = C.Text3, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
    VSpace(6.dp)
}

@Composable
private fun Info(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, color = C.Text2, modifier = Modifier.widthIn(min = 160.dp))
        Text(value, color = C.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Toggle(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp).tvClickable(focusScale = 1.01f) { onChange(!checked) }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = C.Text, fontSize = 15.sp)
            if (subtitle != null) Text(subtitle, color = C.Text3, fontSize = 12.sp)
        }
        HSpace(10.dp)
        Switch(
            checked = checked, onCheckedChange = null,
            colors = SwitchDefaults.colors(checkedTrackColor = C.Accent, uncheckedTrackColor = C.SurfaceHover),
        )
    }
}
