package com.carellice.iptvision.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.carellice.iptvision.AppViewModel
import com.carellice.iptvision.data.Quiz

/** "Cosa guardo?": domande a risposta multipla, poi qualche film o serie da scegliere. */
@Composable
fun QuizDialog(vm: AppViewModel) {
    if (!vm.quizOpen) return
    var step by remember { mutableIntStateOf(0) }
    var round by remember { mutableIntStateOf(0) } // "Altri consigli": nuova estrazione
    val answers = remember { mutableStateMapOf<String, String>() }
    val done = step >= Quiz.questions.size
    val loading = done && (vm.moviesLoading || vm.seriesLoading)
    val result = remember(done, round, vm.movies, vm.series) { if (done && !loading) vm.recommend(answers.toMap()) else null }

    Dialog(onDismissRequest = { vm.quizOpen = false }) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Panel).padding(20.dp)) {
            Text("Cosa guardo?", color = C.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(if (done) "I nostri consigli" else "Domanda ${step + 1} di ${Quiz.questions.size}", color = C.Text2, fontSize = 13.sp)
            VSpace(14.dp)
            if (!done) {
                val q = Quiz.questions[step]
                Text(q.text, color = C.Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                VSpace(10.dp)
                key(step) {
                    LazyColumn(Modifier.heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(4.dp)) {
                        itemsIndexed(q.options) { i, o ->
                            Text(
                                o.label, color = C.Text, fontSize = 15.sp,
                                modifier = Modifier.fillMaxWidth().initialFocus(i == 0, true)
                                    .tvClickable(focusScale = 1.02f) { answers[q.key] = o.value; step++ }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                            )
                        }
                    }
                }
            } else if (loading || result == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = C.Accent)
                    HSpace(14.dp)
                    Text("Cerco qualcosa per te…", color = C.Text2)
                }
            } else {
                result.note?.let { Text(it, color = C.Text2, fontSize = 13.sp); VSpace(8.dp) }
                key(round) {
                    LazyColumn(Modifier.heightIn(max = 400.dp), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(4.dp)) {
                        itemsIndexed(result.picks) { i, p ->
                            val (poster, initials, meta, kind) = when (p) {
                                is Quiz.Pick.Film -> listOf(p.movie.poster, p.movie.initials, p.movie.meta, "Film")
                                is Quiz.Pick.Show -> listOf(p.series.cover, p.series.initials, p.series.meta, "Serie TV")
                            }
                            Row(
                                Modifier.fillMaxWidth().initialFocus(i == 0, true).tvClickable(focusScale = 1.02f) { vm.openPick(p) }.padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Artwork(poster, initials ?: "", Modifier.width(44.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)), ContentScale.Crop, 12)
                                HSpace(12.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(p.name, color = C.Text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(listOfNotNull(kind, meta?.takeIf { it.isNotEmpty() }).joinToString(" · "), color = C.Text2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
                VSpace(12.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("Altri consigli", true) { round++ }
                    Pill("Ricomincia", false) { answers.clear(); step = 0 }
                }
            }
        }
    }
}
