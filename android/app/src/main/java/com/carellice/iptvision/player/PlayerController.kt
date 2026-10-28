package com.carellice.iptvision.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import com.carellice.iptvision.data.Log
import com.carellice.iptvision.data.XtreamClient

enum class PlaybackState { Idle, Connecting, Buffering, Playing, Paused, Reconnecting }

data class TrackOption(val group: Tracks.Group, val index: Int, val label: String, val selected: Boolean)

/**
 * ExoPlayer con riconnessione automatica.
 * Un watchdog controlla che il flusso avanzi davvero: se si blocca senza errori
 * (caso tipico delle IPTV) il canale viene riaperto, aspettando un po' di più a ogni tentativo.
 */
@OptIn(UnstableApi::class)
class PlayerController(context: Context) {
    private val main = Handler(Looper.getMainLooper())

    val player: ExoPlayer

    var state by mutableStateOf(PlaybackState.Idle); private set
    var attempt by mutableIntStateOf(0); private set
    var positionMs by mutableLongStateOf(0L); private set
    var durationMs by mutableLongStateOf(0L); private set
    var bufferedPercent by mutableFloatStateOf(0f); private set
    var videoSize by mutableStateOf(""); private set
    var tracksVersion by mutableIntStateOf(0); private set

    /** Un film o un episodio è arrivato alla fine. */
    var onEnded: (() -> Unit)? = null

    /** Un film o un episodio non si apre nonostante i tentativi. */
    var onFailed: (() -> Unit)? = null

    private var url: String? = null
    var isLive = true; private set
    private var resumeMs = 0L
    private var lastPos = -1L
    private var lastProgressAt = 0L
    private var startedAt = 0L
    private var userPaused = false
    private var everPlayed = false
    private var lastFrames = -1
    private var lastFrameAt = 0L

    init {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(XtreamClient.USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(15_000)
        // Impostazioni standard dell'estrattore TS: con FLAG_DETECT_ACCESS_UNITS e FLAG_ALLOW_NON_IDR_KEYFRAMES
        // i fotogrammi H.264 venivano spezzati male, il decoder smetteva di accettarli e l'immagine si fermava
        // (prima a scatti) mentre l'audio continuava.
        val extractors = DefaultExtractorsFactory()
        val renderers = DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true)
        player = ExoPlayer.Builder(context, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http, extractors))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(s: Int) {
                Log.i("Player: stato $s, live=$isLive, tentativo $attempt")
                when (s) {
                    Player.STATE_ENDED -> {
                        if (url == null) return
                        // Un canale in diretta che "finisce" è un flusso caduto: si riapre.
                        if (isLive) scheduleRetry("flusso terminato") else { state = PlaybackState.Idle; onEnded?.invoke() }
                    }
                    Player.STATE_BUFFERING -> if (state != PlaybackState.Reconnecting) state = if (everPlayed) PlaybackState.Buffering else PlaybackState.Connecting
                    Player.STATE_READY -> updatePlayState()
                    else -> {}
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) = updatePlayState()

            override fun onPlayerError(error: PlaybackException) {
                Log.w("Errore di riproduzione: ${error.errorCodeName}", error)
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition(); player.prepare(); return
                }
                scheduleRetry("errore di riproduzione")
            }

            override fun onTracksChanged(tracks: Tracks) { tracksVersion++ }

            override fun onVideoSizeChanged(v: androidx.media3.common.VideoSize) {
                videoSize = if (v.height > 0) "${v.height}p" else ""
            }
        })
    }

    private fun updatePlayState() {
        if (url == null) return
        if (player.isPlaying) {
            everPlayed = true
            state = PlaybackState.Playing
            lastProgressAt = now()
        } else if (player.playbackState == Player.STATE_READY && !player.playWhenReady) {
            state = PlaybackState.Paused
        }
    }

    val isActive get() = url != null

    fun play(url: String, live: Boolean, resumeMs: Long = 0) {
        main.removeCallbacks(retry)
        this.url = url
        this.isLive = live
        this.resumeMs = resumeMs
        attempt = 0
        everPlayed = false
        userPaused = false
        positionMs = resumeMs
        durationMs = 0
        start()
    }

    private fun start() {
        val u = url ?: return
        val item = MediaItem.Builder().setUri(u).apply {
            if (u.substringBefore('?').endsWith(".m3u8", true)) setMimeType(MimeTypes.APPLICATION_M3U8)
        }.build()
        state = if (attempt > 0) PlaybackState.Reconnecting else PlaybackState.Connecting
        lastPos = -1
        startedAt = now()
        lastProgressAt = startedAt
        lastFrames = -1
        lastFrameAt = startedAt
        player.setMediaItem(item, if (isLive) C.TIME_UNSET else resumeMs)
        player.prepare()
        player.playWhenReady = !userPaused
    }

    private val retry = Runnable { if (url != null) start() }

    private fun scheduleRetry(reason: String) {
        if (url == null) return
        main.removeCallbacks(retry)
        if (!isLive) {
            val p = player.currentPosition
            if (p > 0) resumeMs = p
            if (attempt >= 6) { stop(); onFailed?.invoke(); return }
        }
        attempt++
        state = PlaybackState.Reconnecting
        val delay = minOf(15_000L, 1000L shl minOf(attempt - 1, 4))
        Log.w("Riconnessione ($reason), tentativo $attempt tra ${delay}ms")
        player.stop()
        main.postDelayed(retry, delay)
    }

    private val watchdog = object : Runnable {
        override fun run() {
            main.postDelayed(this, 1000)
            if (url == null) return
            val pos = player.currentPosition
            if (!isLive) {
                positionMs = pos
                durationMs = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            }
            bufferedPercent = player.bufferedPercentage / 100f
            if (state == PlaybackState.Reconnecting && !player.isPlaying) return
            if (userPaused || (player.playbackState == Player.STATE_READY && !player.playWhenReady)) {
                lastProgressAt = now(); return
            }
            // Un flusso TS che smette di arrivare può restare "in riproduzione" con l'orologio che avanza
            // oltre i dati ricevuti: conta come avanzamento solo ciò che sta dentro il buffer.
            val starved = isLive && pos > player.bufferedPosition + 3000
            if (player.isPlaying && pos != lastPos && !starved) {
                lastPos = pos
                lastProgressAt = now()
                if (videoFrozen()) { scheduleRetry("video fermo, audio regolare"); return }
                // Dopo un minuto di visione regolare i tentativi ripartono da capo.
                if (attempt > 0 && now() - startedAt > 60_000) attempt = 0
                return
            }
            val limit = when {
                isLive && everPlayed -> 12_000L
                isLive -> 25_000L
                everPlayed -> 20_000L
                else -> 35_000L
            }
            if (now() - lastProgressAt > limit) scheduleRetry("flusso bloccato")
        }
    }

    /**
     * Il tempo di riproduzione segue l'audio: se il video si blocca (per esempio dopo un salto
     * nei tempi del flusso TS, quando l'emittente riavvia la codifica) i fotogrammi arrivano "in ritardo"
     * e vengono scartati, l'immagine resta ferma e l'audio continua. Qui si contano i fotogrammi
     * davvero mostrati: se per 4 secondi non ne arriva nessuno mentre l'audio va avanti, si riapre il flusso.
     */
    private fun videoFrozen(): Boolean {
        if (player.videoFormat == null) return false // canale solo audio
        val counters = player.videoDecoderCounters ?: return false
        counters.ensureUpdated()
        val frames = counters.renderedOutputBufferCount
        val t = now()
        // Un decoder nuovo riparte da zero: conta come avanzamento.
        if (frames != lastFrames) {
            lastFrames = frames
            lastFrameAt = t
            return false
        }
        return everPlayed && t - startedAt > 8_000 && t - lastFrameAt > 4_000
    }

    init {
        main.post(watchdog)
    }

    fun togglePause() {
        if (url == null) return
        userPaused = player.playWhenReady
        player.playWhenReady = !userPaused
        if (userPaused) state = PlaybackState.Paused
    }

    fun seekBy(deltaMs: Long) {
        if (isLive || url == null) return
        val d = player.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        player.seekTo((player.currentPosition + deltaMs).coerceIn(0, maxOf(0, d - 1000)))
        positionMs = player.currentPosition
    }

    fun seekTo(ms: Long) {
        if (isLive || url == null) return
        player.seekTo(maxOf(0, ms))
        positionMs = ms
    }

    fun stop() {
        main.removeCallbacks(retry)
        url = null
        player.stop()
        player.clearMediaItems()
        state = PlaybackState.Idle
        attempt = 0
    }

    fun currentPosition() = if (url == null) 0 else player.currentPosition
    fun currentDuration() = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0

    fun tracks(type: Int): List<TrackOption> {
        val out = ArrayList<TrackOption>()
        var n = 0
        for (g in player.currentTracks.groups) {
            if (g.type != type) continue
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                n++
                val f = g.getTrackFormat(i)
                val lang = f.language?.let { java.util.Locale(it).displayLanguage.replaceFirstChar { c -> c.uppercase() } }
                val label = listOfNotNull(f.label, lang).distinct().joinToString(" · ").ifBlank { "Traccia $n" }
                out += TrackOption(g, i, label, g.isTrackSelected(i))
            }
        }
        return out
    }

    fun selectTrack(option: TrackOption) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(option.group.type, false)
            .setOverrideForType(TrackSelectionOverride(option.group.mediaTrackGroup, option.index))
            .build()
    }

    fun disableSubtitles() {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
    }

    fun release() {
        main.removeCallbacksAndMessages(null)
        player.release()
    }

    private fun now() = System.currentTimeMillis()
}
