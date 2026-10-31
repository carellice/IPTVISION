using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using IPTVISION.Models;
using IPTVISION.Services;

namespace IPTVISION.ViewModels;

public sealed record QuizOption(string Label, string Value);
public sealed record QuizQuestion(string Key, string Text, IReadOnlyList<QuizOption> Options);

/// <summary>
/// "Cosa guardo?": poche domande a risposta multipla e qualche film o serie consigliati.
/// Il genere si riconosce dal nome della categoria e dal genere della serie (i cataloghi Xtream
/// di solito dividono i film per genere); si escludono i titoli già visti o iniziati.
/// </summary>
public sealed partial class MainViewModel
{
    private const int QuizSuggestions = 6;

    private static readonly QuizQuestion[] QuizQuestions =
    [
        new("type", "Cosa ti va di guardare?",
        [
            new("Un film", "movie"),
            new("Una serie TV", "series"),
            new("Fa lo stesso", "any"),
        ]),
        new("mood", "Che emozioni cerchi?",
        [
            new("Ridere", "comedy"),
            new("Azione e adrenalina", "action"),
            new("Paura e brividi", "horror"),
            new("Emozioni e amore", "drama"),
            new("Fantascienza e fantasy", "fantasy"),
            new("Gialli, crimini e storie vere", "crime"),
            new("Animazione e famiglia", "family"),
            new("Sorprendimi", "any"),
        ]),
        new("period", "Di che periodo?",
        [
            new("Uscito di recente", "recent"),
            new("Anni 2000 e 2010", "2000s"),
            new("Un classico", "classic"),
            new("Fa lo stesso", "any"),
        ]),
        new("rating", "Vuoi andare sul sicuro?",
        [
            new("Sì, solo titoli molto votati", "top"),
            new("Fa lo stesso", "any"),
        ]),
    ];

    /// <summary>Parole (già normalizzate) che riconoscono il genere nel nome della categoria o nel genere.</summary>
    private static readonly Dictionary<string, string[]> MoodWords = new()
    {
        ["comedy"] = ["commedi", "comed", "comic", "umor", "sitcom", "parodi"],
        ["action"] = ["azion", "action", "avventur", "adventur", "thriller", "guerra", "war", "western", "spionag", "marzial", "martial"],
        ["horror"] = ["horror", "terror", "paura", "brivid", "zombi", "slasher", "soprannatural", "supernatural"],
        ["drama"] = ["dramm", "drama", "romant", "romanc", "amore", "love", "sentiment"],
        ["fantasy"] = ["fantasy", "fantasc", "sci fi", "scifi", "science fiction", "fantastic", "supereroi", "superhero", "marvel"],
        ["crime"] = ["crime", "crimin", "giall", "poliz", "mister", "myster", "document", "docu", "biograf", "true story", "storic"],
        ["family"] = ["animaz", "animat", "cartoon", "cartoni", "bambin", "kids", "famigl", "family", "disney", "ragazz"],
    };

    private readonly Dictionary<string, string> _quizAnswers = [];
    private int _quizIndex;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsQuizDone))]
    private bool _isQuizOpen;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsQuizAsking), nameof(IsQuizDone))]
    private QuizQuestion? _quizQuestion;

    [ObservableProperty] private string _quizStep = "";
    [ObservableProperty] private bool _isQuizLoading;
    [ObservableProperty] private IReadOnlyList<SearchHit> _quizResults = [];
    [ObservableProperty] private string? _quizNote;

    public bool IsQuizAsking => QuizQuestion != null;
    public bool IsQuizDone => IsQuizOpen && QuizQuestion == null;

    [RelayCommand]
    private void OpenQuiz()
    {
        IsSettingsOpen = false;
        IsDownloadsOpen = false;
        _quizAnswers.Clear();
        _quizIndex = 0;
        QuizResults = [];
        QuizNote = null;
        ShowQuizQuestion();
        IsQuizOpen = true;
        // Il catalogo di film e serie serve alla fine: si carica mentre si risponde.
        if (_client != null) _ = EnsureMoviesAsync();
        if (_client != null) _ = EnsureSeriesAsync();
    }

    [RelayCommand]
    private void CloseQuiz() => IsQuizOpen = false;

    [RelayCommand]
    private async Task AnswerQuiz(QuizOption? option)
    {
        if (option == null || QuizQuestion == null) return;
        _quizAnswers[QuizQuestion.Key] = option.Value;
        _quizIndex++;
        if (_quizIndex < QuizQuestions.Length)
        {
            ShowQuizQuestion();
            return;
        }
        QuizQuestion = null;
        QuizStep = "I nostri consigli";
        await ComputeQuizAsync();
    }

    [RelayCommand]
    private async Task QuizMore() => await ComputeQuizAsync();

    [RelayCommand]
    private void QuizRestart() => OpenQuiz();

    [RelayCommand]
    private void QuizOpenResult(SearchHit? hit)
    {
        if (hit == null) return;
        IsQuizOpen = false;
        ActivateSearchHit(hit);
    }

    private void ShowQuizQuestion()
    {
        QuizQuestion = QuizQuestions[_quizIndex];
        QuizStep = $"Domanda {_quizIndex + 1} di {QuizQuestions.Length}";
    }

    private async Task ComputeQuizAsync()
    {
        IsQuizLoading = true;
        try
        {
            if (_client != null) await Task.WhenAll(EnsureMoviesAsync(), EnsureSeriesAsync());
        }
        catch (Exception ex)
        {
            Log.Write("Catalogo per i consigli non disponibile", ex);
        }
        finally
        {
            IsQuizLoading = false;
        }
        if (!IsQuizOpen) return;
        (QuizResults, QuizNote) = Recommend(_quizAnswers, Random.Shared);
    }

    private sealed record QuizCandidate(ArtworkItem Item, string Name, string Text, int Year, double Rating);

    private (IReadOnlyList<SearchHit>, string?) Recommend(IReadOnlyDictionary<string, string> answers, Random rnd)
    {
        var type = answers.GetValueOrDefault("type", "any");
        var mood = answers.GetValueOrDefault("mood", "any");
        var period = answers.GetValueOrDefault("period", "any");
        var top = answers.GetValueOrDefault("rating") == "top";

        var vodNames = _vodCats.ToDictionary(c => c.Id, c => c.Name);
        var seriesNames = _seriesCats.ToDictionary(c => c.Id, c => c.Name);
        var pool = new List<QuizCandidate>();
        // Solo titoli nuovi: niente film già visti o iniziati, niente serie già aperte.
        if (type != "series")
            pool.AddRange(_movies.Where(m => _positions.GetProgress(m.Key) == 0)
                .Select(m => new QuizCandidate(m, m.Name, TextHelpers.Normalize(vodNames.GetValueOrDefault(m.CategoryId ?? "") ?? ""), YearOf(m.Data.Year), m.Data.Rating)));
        if (type != "movie")
            pool.AddRange(_series.Where(s => _positions.GetLastEpisode(s.SeriesId) == null)
                .Select(s => new QuizCandidate(s, s.Name, TextHelpers.Normalize($"{seriesNames.GetValueOrDefault(s.CategoryId ?? "")} {s.Data.Genre}"), YearOf(s.Data.Year), s.Data.Rating)));
        if (pool.Count == 0) return ([], "Il catalogo non è ancora disponibile: riprova tra poco.");

        var now = DateTime.Now.Year;
        var maxRating = pool.Max(c => c.Rating);
        bool MoodOk(QuizCandidate c) => mood == "any" || MoodWords[mood].Any(w => c.Text.Contains(w, StringComparison.Ordinal));
        bool PeriodOk(QuizCandidate c) => period switch
        {
            "recent" => c.Year >= now - 3,
            "2000s" => c.Year >= 2000 && c.Year < now - 3,
            "classic" => c.Year > 1900 && c.Year < 2000,
            _ => true,
        };
        bool RatingOk(QuizCandidate c) => !top || maxRating <= 0 || c.Rating >= maxRating * 0.7;

        // Se nessun titolo soddisfa tutte le risposte si rinuncia prima al voto, poi al periodo, poi al genere.
        string? note = null;
        var picks = pool.Where(c => MoodOk(c) && PeriodOk(c) && RatingOk(c)).ToList();
        if (picks.Count == 0) { picks = pool.Where(c => MoodOk(c) && PeriodOk(c)).ToList(); note = "Nessun titolo con tutte le risposte: ecco i più vicini."; }
        if (picks.Count == 0) picks = pool.Where(MoodOk).ToList();
        if (picks.Count == 0) { picks = pool; note = "Nel catalogo non ho trovato quel genere: ecco qualcosa da scoprire."; }

        // Un po' di caso, ma i titoli più votati hanno più probabilità di uscire.
        var hits = picks
            .Select(c => (c, score: (c.Rating > 0 ? c.Rating : maxRating * 0.4) * (0.5 + rnd.NextDouble())))
            .OrderByDescending(t => t.score)
            .Select(t => t.c)
            .DistinctBy(c => TextHelpers.VariantKey(c.Name))
            .Take(QuizSuggestions)
            .Select(c => c.Item switch
            {
                Movie m => new SearchHit(m, "Film", m.Name, TextHelpers.JoinMeta("Film", m.Meta)),
                Series s => new SearchHit(s, "Serie TV", s.Name, TextHelpers.JoinMeta("Serie TV", s.Meta)),
                _ => null,
            })
            .OfType<SearchHit>()
            .ToList();
        return (hits, note);
    }

    private static int YearOf(string? year) =>
        year != null && year.Length >= 4 && int.TryParse(year.AsSpan(0, 4), out var y) ? y : 0;
}
