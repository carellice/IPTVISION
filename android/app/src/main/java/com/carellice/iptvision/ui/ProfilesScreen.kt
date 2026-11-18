package com.carellice.iptvision.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.data.Profile

// Profili del server di casa, come Netflix: "Chi guarda?" all'apertura e l'elenco nelle impostazioni.
// Ogni profilo ha i suoi preferiti, Continua a guardare e La mia lista.

/** "Chi guarda?" sopra tutta l'app: all'apertura con più profili, o da Impostazioni → Profili. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfilePicker(vm: AppViewModel) {
    val mode = vm.profilePicker ?: return
    var locked by remember { mutableStateOf<Profile?>(null) }
    Dialog(
        onDismissRequest = { if (mode == "switch") vm.openProfilePicker(false) },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = mode == "switch", dismissOnClickOutside = false),
    ) {
        Column(
            Modifier.fillMaxSize().material(C.Bg).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Chi guarda?", color = C.Text, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                vm.profiles.forEach { p ->
                    Column(
                        Modifier.width(116.dp).tvClickable(background = androidx.compose.ui.graphics.Color.Transparent) {
                            if (p.hasPin) locked = p else vm.switchProfile(p, "")
                        }.padding(10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Avatar(p, p.id == vm.currentProfile, 84.dp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(p.name, color = C.Text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                            if (p.hasPin) Icon(Icons.Default.Lock, "Con PIN", tint = C.Text3, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                        }
                    }
                }
            }
            if (locked == null) vm.profileError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
            if (vm.profileBusy && locked == null) Loading(null, Modifier.size(40.dp))
            if (mode == "switch") ActionButton("Annulla", null) { vm.openProfilePicker(false) }
        }
    }
    locked?.let { p -> PinDialog(vm, "PIN di ${p.name}", onDismiss = { locked = null; vm.profileError = null }) { pin -> vm.switchProfile(p, pin) { locked = null } } }
}

@Composable
private fun Avatar(p: Profile, selected: Boolean, size: Dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size / 4)).background(if (selected) C.Accent else C.Surface),
        contentAlignment = Alignment.Center,
    ) {
        Text(p.name.take(1).uppercase(), color = if (selected) C.OnAccent else C.Text, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun FormDialog(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(24.dp).fillMaxWidth().clip(skinCorners(18.dp)).material(C.Panel).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, color = C.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

private fun digits(s: String) = s.filter { it.isDigit() }.take(8)

/** Chiede il PIN; un PIN sbagliato resta come errore in vm.profileError. */
@Composable
private fun PinDialog(vm: AppViewModel, title: String, onDismiss: () -> Unit, onPin: (String) -> Unit) {
    var pin by remember { mutableStateOf("") }
    val done = { onPin(pin); pin = "" }
    FormDialog(title, onDismiss) {
        Field(pin, { pin = digits(it) }, "PIN", null, KeyboardType.NumberPassword, password = true, done = done, autoFocus = true)
        vm.profileError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
        if (vm.profileBusy) Loading(null, Modifier.fillMaxWidth().padding(8.dp))
        else ActionButton("Conferma", null, primary = true, modifier = Modifier.fillMaxWidth()) { done() }
    }
}

/** Impostazioni → Profili (solo col server di casa): chi guarda, aggiungi, modifica quello in uso, elimina gli altri. */
@Composable
fun ProfilesGroup(vm: AppViewModel, group: @Composable (String) -> Unit) {
    if (vm.settings.homeServer == null || vm.profiles.isEmpty()) return
    var editing by remember { mutableStateOf<Profile?>(null) }
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Profile?>(null) }
    group("Profili")
    Text(
        "Ogni profilo ha i suoi preferiti, Continua a guardare e La mia lista. Con più profili, all'apertura compare \"Chi guarda?\".",
        color = C.Text3, fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp),
    )
    vm.profiles.forEach { p ->
        val current = p.id == vm.currentProfile
        Row(
            Modifier.fillMaxWidth().padding(vertical = 3.dp).background(C.Surface, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(p, current, 36.dp)
            HSpace(12.dp)
            Column(Modifier.weight(1f)) {
                Text(p.name + if (current) " · in uso" else "", color = C.Text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text((if (p.hasPin) "Con PIN" else "Senza PIN") + if (p.id == 0) " · principale" else "", color = C.Text3, fontSize = 12.sp)
            }
            if (current) ActionButton("Modifica", null) { vm.profileError = null; editing = p }
            else if (p.id != 0) ActionButton("Elimina", null) { vm.profileError = null; removing = p }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 6.dp)) {
        if (vm.profiles.size > 1) ActionButton("Cambia profilo", Icons.Default.Person) { vm.openProfilePicker(true) }
        ActionButton("Aggiungi profilo", Icons.Default.Add) { vm.profileError = null; adding = true }
    }
    if (adding) EditDialog(vm, null) { adding = false }
    editing?.let { p -> EditDialog(vm, p) { editing = null } }
    removing?.let { p ->
        if (p.hasPin) PinDialog(vm, "Elimina ${p.name}", onDismiss = { removing = null }) { pin -> vm.removeProfile(p, pin) { removing = null } }
        else FormDialog("Elimina ${p.name}", { removing = null }) {
            Text("Vanno via i suoi preferiti, Continua a guardare e La mia lista.", color = C.Text2, fontSize = 14.sp)
            vm.profileError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
            ActionButton("Elimina", null, primary = true, modifier = Modifier.fillMaxWidth()) { vm.removeProfile(p, "") { removing = null } }
        }
    }
}

/** Nuovo profilo ([p] null) oppure nome e PIN di quello in uso. */
@Composable
private fun EditDialog(vm: AppViewModel, p: Profile?, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(p?.name ?: "") }
    var pin by remember { mutableStateOf("") }
    val save = { vm.saveProfile(p?.id, name, pin.ifEmpty { null }, onDismiss) }
    FormDialog(if (p == null) "Nuovo profilo" else "Modifica profilo", onDismiss) {
        Field(name, { name = it }, "Nome", null, KeyboardType.Text)
        Field(pin, { pin = digits(it) }, if (p?.hasPin == true) "Nuovo PIN" else "PIN (facoltativo)",
            if (p?.hasPin == true) "vuoto: resta quello di prima" else "da 4 a 8 cifre", KeyboardType.NumberPassword, password = true, done = save)
        vm.profileError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
        if (vm.profileBusy) Loading(null, Modifier.fillMaxWidth().padding(8.dp))
        else {
            ActionButton("Salva", null, primary = true, modifier = Modifier.fillMaxWidth()) { save() }
            if (p?.hasPin == true) ActionButton("Togli il PIN", null, modifier = Modifier.fillMaxWidth()) { vm.saveProfile(p.id, name, "", onDismiss) }
        }
    }
}
