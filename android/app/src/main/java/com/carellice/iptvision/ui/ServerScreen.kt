package com.carellice.iptvision.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.carellice.iptvision.AppViewModel

/** Come esce su Internet il server di casa: pallino verde con la VPN attiva, rosso senza, e paese e indirizzo. */
@Composable
fun ServerNetworkLine(vm: AppViewModel, modifier: Modifier = Modifier) {
    val n = vm.serverNetwork ?: return
    val vpn = if (n.isNull("vpn")) null else n.optBoolean("vpn")
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(when (vpn) { true -> Color(0xFF3DDC97); false -> C.Danger; null -> C.Text3 }))
        Text(n.optString("label"), color = C.Text2, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

/**
 * "Server di casa": collega l'app a IPTVISION installato su CasaOS. Da lì passano liste, guida e
 * flussi, e preferiti e posizioni sono quelli dell'account del server.
 */
@Composable
fun ServerDialog(vm: AppViewModel) {
    if (!vm.serverDialog) return
    var address by rememberSaveable { mutableStateOf(vm.settings.homeServer ?: "") }
    var user by rememberSaveable { mutableStateOf("") }
    var pass by rememberSaveable { mutableStateOf("") }
    var invite by rememberSaveable { mutableStateOf("") }
    var register by rememberSaveable { mutableStateOf(false) }
    val connect = { vm.connectServer(address, user, pass, register, invite) }

    Dialog(onDismissRequest = { if (!vm.serverBusy) { vm.serverDialog = false; vm.serverError = null } }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(24.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).material(C.Panel)
                .verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Server di casa", color = C.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(
                "Collega l'app a IPTVISION sul tuo server CasaOS: canali, film e serie passeranno da lì, " +
                    "e preferiti e Continua a guardare saranno gli stessi su ogni dispositivo.",
                color = C.Text2, fontSize = 13.sp,
            )
            Field(address, { address = it }, "Indirizzo del server", "http://192.168.1.10:8765", KeyboardType.Uri)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("Ho già un account", !register) { register = false }
                Pill("Creane uno", register) { register = true }
            }
            Field(user, { user = it }, "Nome utente", null, KeyboardType.Text)
            Field(pass, { pass = it }, "Password", null, KeyboardType.Password, password = true, done = if (register) null else connect)
            if (register) Field(invite, { invite = it }, "Codice invito", "se il server lo chiede", KeyboardType.Text, done = connect)
            vm.serverError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
            if (vm.serverBusy) Loading("Collegamento in corso…", Modifier.fillMaxWidth().padding(8.dp))
            else ActionButton("Collega il server", Icons.Default.Dns, primary = true, modifier = Modifier.fillMaxWidth()) { connect() }
            Text(
                "Dentro casa basta l'indirizzo IP del server con la porta (http://…). Fuori casa usa l'indirizzo Tailscale (https://…ts.net). " +
                    "Lo trovi anche in IPTVISION nel browser, in Impostazioni → Server di casa.",
                color = C.Text3, fontSize = 12.sp,
            )
        }
    }
}
