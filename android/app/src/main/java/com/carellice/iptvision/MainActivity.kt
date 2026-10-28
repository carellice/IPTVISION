package com.carellice.iptvision

import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import com.carellice.iptvision.ui.C
import com.carellice.iptvision.ui.HomeScreen
import com.carellice.iptvision.ui.IptvTheme
import com.carellice.iptvision.ui.LoginScreen
import com.carellice.iptvision.ui.MovieDetailScreen
import com.carellice.iptvision.ui.PlayerScreen
import com.carellice.iptvision.ui.SeriesDetailScreen
import com.carellice.iptvision.ui.VariantDialog

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()
    private var resumeOnStart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContent {
            IptvTheme {
                // Ricerca vocale: su Android TV è il microfono del telecomando, sul telefono quello di Google.
                val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
                    r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(vm::setQuery)
                }
                val startVoice = {
                    val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT")
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, "Cosa vuoi guardare?")
                    try { voice.launch(i) } catch (_: Exception) {
                        Toast.makeText(this, "Ricerca vocale non disponibile su questo dispositivo", Toast.LENGTH_SHORT).show()
                    }
                }

                LaunchedEffect(vm.playError) {
                    vm.playError?.let { Toast.makeText(this@MainActivity, it, Toast.LENGTH_LONG).show(); vm.playError = null }
                }
                LaunchedEffect(vm.error) {
                    vm.error?.let { if (vm.live != null) { Toast.makeText(this@MainActivity, it, Toast.LENGTH_LONG).show(); vm.error = null } }
                }

                BackHandler(enabled = vm.canGoBack) { vm.back() }

                Box(
                    Modifier.fillMaxSize().background(C.Bg).onPreviewKeyEvent { e ->
                        // Indietro del telecomando: si naviga subito, senza che Compose lo usi prima per togliere il focus.
                        // Il player gestisce da sé il proprio.
                        val handled = e.key == Key.Back && vm.screen != Screen.Player && vm.canGoBack
                        if (handled && e.type == KeyEventType.KeyUp) vm.back()
                        handled
                    },
                ) {
                    when (val s = vm.screen) {
                        Screen.Login -> LoginScreen(vm)
                        Screen.Home -> HomeScreen(vm, startVoice)
                        is Screen.MovieDetail -> MovieDetailScreen(vm, s.movie)
                        is Screen.SeriesDetail -> SeriesDetailScreen(vm, s.series)
                        Screen.Player -> PlayerScreen(vm)
                    }
                    VariantDialog(vm)
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        vm.onStop()
        // In background la TV non deve continuare a suonare.
        resumeOnStart = vm.screen == Screen.Player && vm.player.player.playWhenReady
        if (resumeOnStart) vm.player.togglePause()
    }

    override fun onStart() {
        super.onStart()
        if (resumeOnStart && vm.screen == Screen.Player) vm.player.togglePause()
        resumeOnStart = false
    }
}
