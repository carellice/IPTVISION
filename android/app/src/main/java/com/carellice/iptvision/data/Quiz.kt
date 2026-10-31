package com.carellice.iptvision.data

import java.util.Calendar
import kotlin.random.Random

/**
 * "Cosa guardo?": poche domande a risposta multipla e qualche film o serie consigliati.
 * Il genere si riconosce dal nome della categoria e dal genere della serie (i cataloghi Xtream
 * di solito dividono i film per genere); si escludono i titoli già visti o iniziati.
 * Stesse domande e stesse regole delle versioni Windows e TV.
 */
object Quiz {
    data class Option(val label: String, val value: String)
    data class Question(val key: String, val text: String, val options: List<Option>)

    val questions = listOf(
        Question("type", "Cosa ti va di guardare?", listOf(
            Option("Un film", "movie"),
            Option("Una serie TV", "series"),
            Option("Fa lo stesso", "any"),
        )),
        Question("mood", "Che emozioni cerchi?", listOf(
            Option("Ridere", "comedy"),
            Option("Azione e adrenalina", "action"),
            Option("Paura e brividi", "horror"),
            Option("Emozioni e amore", "drama"),
            Option("Fantascienza e fantasy", "fantasy"),
            Option("Gialli, crimini e storie vere", "crime"),
            Option("Animazione e famiglia", "family"),
            Option("Sorprendimi", "any"),
        )),
        Question("period", "Di che periodo?", listOf(
            Option("Uscito di recente", "recent"),
            Option("Anni 2000 e 2010", "2000s"),
            Option("Un classico", "classic"),
            Option("Fa lo stesso", "any"),
        )),
        Question("rating", "Vuoi andare sul sicuro?", listOf(
            Option("Sì, solo titoli molto votati", "top"),
            Option("Fa lo stesso", "any"),
        )),
    )

    /** Parole (già normalizzate) che riconoscono il genere nel nome della categoria o nel genere. */
    private val moodWords = mapOf(
        "comedy" to listOf("commedi", "comed", "comic", "umor", "sitcom", "parodi"),
        "action" to listOf("azion", "action", "avventur", "adventur", "thriller", "guerra", "war", "western", "spionag", "marzial", "martial"),
        "horror" to listOf("horror", "terror", "paura", "brivid", "zombi", "slasher", "soprannatural", "supernatural"),
        "drama" to listOf("dramm", "drama", "romant", "romanc", "amore", "love", "sentiment"),
        "fantasy" to listOf("fantasy", "fantasc", "sci fi", "scifi", "science fiction", "fantastic", "supereroi", "superhero", "marvel"),
        "crime" to listOf("crime", "crimin", "giall", "poliz", "mister", "myster", "document", "docu", "biograf", "true story", "storic"),
        "family" to listOf("animaz", "animat", "cartoon", "cartoni", "bambin", "kids", "famigl", "family", "disney", "ragazz"),
    )

    /** Un consiglio: un film oppure una serie. */
    sealed interface Pick {
        val name: String
        data class Film(val movie: Movie) : Pick { override val name get() = movie.name }
        data class Show(val series: Series) : Pick { override val name get() = series.name }
    }

    data class Result(val picks: List<Pick>, val note: String?)

    private class Candidate(val pick: Pick, val text: String, val year: Int, val rating: Double)

    private fun yearOf(y: String?) = y?.take(4)?.toIntOrNull() ?: 0

    fun recommend(
        answers: Map<String, String>,
        movies: List<Movie>, movieCats: List<Category>,
        series: List<Series>, seriesCats: List<Category>,
        isNew: (Pick) -> Boolean,
        rnd: Random = Random.Default,
    ): Result {
        val type = answers["type"] ?: "any"
        val mood = answers["mood"] ?: "any"
        val period = answers["period"] ?: "any"
        val top = answers["rating"] == "top"
        val vodNames = movieCats.associate { it.id to it.name }
        val seriesNames = seriesCats.associate { it.id to it.name }

        val pool = buildList {
            if (type != "series") movies.forEach { m ->
                val p = Pick.Film(m)
                if (isNew(p)) add(Candidate(p, TextHelpers.normalize(vodNames[m.categoryId] ?: ""), yearOf(m.year), m.rating))
            }
            if (type != "movie") series.forEach { s ->
                val p = Pick.Show(s)
                if (isNew(p)) add(Candidate(p, TextHelpers.normalize("${seriesNames[s.categoryId] ?: ""} ${s.genre ?: ""}"), yearOf(s.year), s.rating))
            }
        }
        if (pool.isEmpty()) return Result(emptyList(), "Il catalogo non è ancora disponibile: riprova tra poco.")

        val now = Calendar.getInstance().get(Calendar.YEAR)
        val maxRating = pool.maxOf { it.rating }
        fun moodOk(c: Candidate) = mood == "any" || moodWords[mood].orEmpty().any { c.text.contains(it) }
        fun periodOk(c: Candidate) = when (period) {
            "recent" -> c.year >= now - 3
            "2000s" -> c.year in 2000 until now - 3
            "classic" -> c.year in 1901..1999
            else -> true
        }
        fun ratingOk(c: Candidate) = !top || maxRating <= 0 || c.rating >= maxRating * 0.7

        // Se nessun titolo soddisfa tutte le risposte si rinuncia prima al voto, poi al periodo, poi al genere.
        var note: String? = null
        var picks = pool.filter { moodOk(it) && periodOk(it) && ratingOk(it) }
        if (picks.isEmpty()) { picks = pool.filter { moodOk(it) && periodOk(it) }; note = "Nessun titolo con tutte le risposte: ecco i più vicini." }
        if (picks.isEmpty()) picks = pool.filter { moodOk(it) }
        if (picks.isEmpty()) { picks = pool; note = "Nel catalogo non ho trovato quel genere: ecco qualcosa da scoprire." }

        // Un po' di caso, ma i titoli più votati hanno più probabilità di uscire.
        val chosen = picks
            .map { it to (if (it.rating > 0) it.rating else maxRating * 0.4) * (0.5 + rnd.nextDouble()) }
            .sortedByDescending { it.second }
            .map { it.first.pick }
            .distinctBy { TextHelpers.variantKey(it.name) }
            .take(6)
        return Result(chosen, note)
    }
}
