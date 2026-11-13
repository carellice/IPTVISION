package com.carellice.iptvision

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
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
import com.carellice.iptvision.ui.QuizDialog
import com.carellice.iptvision.ui.SeriesDetailScreen
import com.carellice.iptvision.ui.ServerDialog
import com.carellice.iptvision.ui.VariantDialog

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()
    private var resumeOnStart = false
    private var recognizer: SpeechRecognizer? = null

    private fun speechIntent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT")
        .putExtra(RecognizerIntent.EXTRA_PROMPT, "Cosa vuoi guardare?")

    /**
     * Android TV: l'intent di sistema apre la barra di ricerca di Google TV senza far partire l'ascolto.
     * Qui l'app ascolta da sé, subito, e scrive il testo nella ricerca mentre si parla.
     */
    private fun listen() {
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also { recognizer = it }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { Toast.makeText(this@MainActivity, "Ti ascolto…", Toast.LENGTH_SHORT).show() }
            override fun onPartialResults(partial: Bundle?) { text(partial)?.let(vm::setQuery) }
            override fun onResults(results: Bundle?) { text(results)?.let(vm::setQuery) }
            override fun onError(error: Int) {
                val msg = if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) "Non ho sentito niente, riprova" else "Ricerca vocale non riuscita, riprova"
                Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            private fun text(b: Bundle?) = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }
        })
        r.startListening(speechIntent().putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true))
    }

    override fun onDestroy() {
        recognizer?.destroy()
        super.onDestroy()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContent {
            IptvTheme {
                // Ricerca vocale: su Android TV è il microfono del telecomando, sul telefono quello di Google.
                val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
                    r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(vm::setQuery)
                }
                val systemVoice = {
                    try { voice.launch(speechIntent()) } catch (_: Exception) {
                        Toast.makeText(this, "Ricerca vocale non disponibile su questo dispositivo", Toast.LENGTH_SHORT).show()
                    }
                }
                // Senza il permesso del microfono si torna alla ricerca vocale di sistema.
                val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) listen() else systemVoice() }
                val startVoice = {
                    when {
                        !vm.isTv || !SpeechRecognizer.isRecognitionAvailable(this) -> systemVoice()
                        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> listen()
                        else -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
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
                    QuizDialog(vm)
                    ServerDialog(vm)
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
