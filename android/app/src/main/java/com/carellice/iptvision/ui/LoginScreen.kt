package com.carellice.iptvision.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Login
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.R

@Composable
fun LoginScreen(vm: AppViewModel) {
    var server by rememberSaveable { mutableStateOf(vm.settings.server ?: "") }
    var user by rememberSaveable { mutableStateOf(vm.settings.username ?: "") }
    var pass by rememberSaveable { mutableStateOf("") }

    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(androidx.compose.ui.graphics.Color(0xFF0F1830), C.Bg)))
            .systemBarsPadding().imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.logo), null, Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)))
                HSpace(14.dp)
                Column {
                    Text("IPTVISION", color = C.Text, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Text("Accedi al tuo account Xtream Codes", color = C.Text2, fontSize = 14.sp)
                }
            }
            VSpace(6.dp)
            Field(server, { server = it }, "Server o link M3U", "http://server:porta oppure il link get.php completo", KeyboardType.Uri)
            Field(user, { user = it }, "Nome utente", null, KeyboardType.Text)
            Field(pass, { pass = it }, "Password", null, KeyboardType.Password, password = true, done = { vm.login(server, user, pass) })
            vm.loginError?.let { Text(it, color = C.Danger, fontSize = 14.sp) }
            if (vm.loginBusy) Loading("Accesso in corso…", Modifier.fillMaxWidth().padding(8.dp))
            else ActionButton("Accedi", Icons.Default.Login, primary = true, modifier = Modifier.fillMaxWidth()) { vm.login(server, user, pass) }
            Text(
                "Se incolli il link M3U completo, nome utente e password si compilano da soli. " +
                    "IPTVISION è solo un lettore e non contiene canali.",
                color = C.Text3, fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun Field(
    value: String, onChange: (String) -> Unit, label: String, hint: String?, type: KeyboardType,
    password: Boolean = false, done: (() -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        placeholder = hint?.let { { Text(it, color = C.Text3) } },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = if (done != null) ImeAction.Done else ImeAction.Next, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { done?.invoke() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = C.Accent, unfocusedBorderColor = C.StrokeStrong,
            focusedContainerColor = C.Panel, unfocusedContainerColor = C.Panel,
        ),
        modifier = Modifier.fillMaxWidth().dpadLeavable(),
    )
}
