using System.Globalization;
using System.Text;
using System.Windows.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using IPTVISION.Services;

namespace IPTVISION.Models;

public enum LibraryMode { Live, Movies, Series }

public sealed record Category(string Id, string Name);

/// <summary>Dati grezzi di un canale, serializzati nella cache su disco.</summary>
public sealed class ChannelData
{
    public int StreamId { get; set; }
    public int Num { get; set; }
    public string Name { get; set; } = "";
    public string? Logo { get; set; }
    public string? CategoryId { get; set; }
    public string? EpgId { get; set; }
}

/// <summary>Dati grezzi di un film (get_vod_streams).</summary>
public sealed class VodData
{
    public int StreamId { get; set; }
    public string Name { get; set; } = "";
    public string? Poster { get; set; }
    public string? CategoryId { get; set; }
    public string? Extension { get; set; }
    public string? Year { get; set; }
    public double Rating { get; set; }
    public long Added { get; set; }
}

/// <summary>Dati grezzi di una serie (get_series).</summary>
public sealed class SeriesData
{
    public int SeriesId { get; set; }
    public string Name { get; set; } = "";
    public string? Cover { get; set; }
    public string? CategoryId { get; set; }
    public string? Year { get; set; }
    public double Rating { get; set; }
    public string? Plot { get; set; }
    public string? Genre { get; set; }
}

public sealed record Programme(DateTimeOffset Start, DateTimeOffset Stop, string Title, string? Description)
{
    public string TimeRange => $"{Start.ToLocalTime():HH\\:mm} – {Stop.ToLocalTime():HH\\:mm}";

    public double ProgressAt(DateTimeOffset now)
    {
        var total = (Stop - Start).TotalSeconds;
        if (total <= 0) return 0;
        return Math.Clamp((now - Start).TotalSeconds / total, 0, 1);
    }
}

public sealed class AuthInfo
{
    public string? Status { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public int MaxConnections { get; init; }
    public IReadOnlyList<string> OutputFormats { get; init; } = [];
}

/// <summary>Dettagli di un film (get_vod_info), caricati quando parte la riproduzione.</summary>
public sealed class VodInfo
{
    public string? Plot { get; init; }
    public string? Genre { get; init; }
    public string? Year { get; init; }
    public string? Duration { get; init; }
    public string? Director { get; init; }
    public string? Cast { get; init; }
}

/// <summary>Dettagli di una serie con tutti gli episodi (get_series_info).</summary>
public sealed class SeriesInfo
{
    public string? Plot { get; init; }
    public string? Genre { get; init; }
    public string? Year { get; init; }
    public string? Cast { get; init; }
    public List<Episode> Episodes { get; init; } = [];
}

public sealed partial class CategoryItem : ObservableObject
{
    public const string AllId = "__all";
    public const string FavoritesId = "__fav";
    public const string ContinueId = "__continue";

    public CategoryItem(string id, string name) { Id = id; Name = name; }

    public string Id { get; }
    public string Name { get; }
    public bool IsFavorites => Id == FavoritesId;
    public bool IsContinue => Id == ContinueId;

    [ObservableProperty] private int _count;
    [ObservableProperty] private bool _isTvFocused;

    public string Glyph => Id switch
    {
        FavoritesId => "",
        ContinueId => "",
        AllId => "",
        _ => "",
    };
}

public sealed partial class SeasonItem(int number, string name, int count) : ObservableObject
{
    public int Number { get; } = number;
    public string Name { get; } = name;
    public int Count { get; } = count;

    [ObservableProperty] private bool _isTvFocused;
    [ObservableProperty] private bool _isActive;
}

/// <summary>Intestazione di gruppo nei risultati di ricerca ("Canali", "Film", "Serie TV").</summary>
public sealed record SearchHeader(string Title, int Count);

/// <summary>Un risultato della ricerca unica: canale, film o serie.</summary>
public sealed partial class SearchHit(object item, string kind, string title, string? subtitle) : ObservableObject
{
    public object Item { get; } = item;
    public string Kind { get; } = kind;
    public string Title { get; } = title;
    public string? Subtitle { get; } = subtitle;
    public string Initials => TextHelpers.Initials(Title);
    public bool IsPoster => Item is ArtworkItem;

    [ObservableProperty] private bool _isTvFocused;
}

public enum TvSection { Live, Movies, Series, Search, Exit }
public enum TvScreen { Categories, Items, Series, Search }
public enum TvZone { Tabs, Search, Seasons, Grid }

public sealed partial class TvTab(TvSection section, string title, string glyph) : ObservableObject
{
    public TvSection Section { get; } = section;
    public string Title { get; } = title;
    public string Glyph { get; } = glyph;

    [ObservableProperty] private bool _isTvFocused;
    [ObservableProperty] private bool _isActive;
}

/// <summary>Una riga della griglia in modalità TV (le righe sono virtualizzate, non i singoli riquadri).</summary>
public sealed record TvRow(IReadOnlyList<object> Items, int Columns);

public static class TextHelpers
{
    public static string Normalize(string s)
    {
        var d = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(d.Length);
        foreach (var c in d)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
            else if (sb.Length > 0 && sb[^1] != ' ') sb.Append(' ');
        }
        return sb.ToString().Trim();
    }

    public static string Initials(string name)
    {
        var parts = name.Split([' ', '-', '_', '|', ':'], StringSplitOptions.RemoveEmptyEntries)
                        .Where(p => p.Any(char.IsLetterOrDigit)).ToArray();
        if (parts.Length == 0) return "TV";
        if (parts.Length == 1) return new string(parts[0].Where(char.IsLetterOrDigit).Take(2).ToArray()).ToUpperInvariant();
        return string.Concat(parts.Take(2).Select(p => char.ToUpperInvariant(p.First(char.IsLetterOrDigit))));
    }

    public static string FormatTime(long ms)
    {
        if (ms < 0) ms = 0;
        var t = TimeSpan.FromMilliseconds(ms);
        return t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes}:{t.Seconds:00}";
    }

    public static string JoinMeta(params string?[] parts) =>
        string.Join("  ·  ", parts.Where(p => !string.IsNullOrWhiteSpace(p)));
}

public sealed partial class Channel : ObservableObject
{
    private ImageSource? _logo;
    private bool _logoRequested;

    public Channel(ChannelData data)
    {
        Data = data;
        SearchKey = TextHelpers.Normalize(data.Name);
        Initials = TextHelpers.Initials(data.Name);
    }

    public ChannelData Data { get; }
    public int StreamId => Data.StreamId;
    public int Num => Data.Num;
    public string Name => Data.Name;
    public string? CategoryId => Data.CategoryId;
    public string? EpgId => Data.EpgId;
    public string SearchKey { get; }
    public string Initials { get; }

    [ObservableProperty] private bool _isFavorite;
    [ObservableProperty] private bool _isPlaying;
    [ObservableProperty] private bool _isTvFocused;
    [ObservableProperty] private string? _nowTitle;
    [ObservableProperty] private double _nowProgress;

    /// <summary>Il logo si scarica solo quando la riga diventa visibile (virtualizzazione).</summary>
    public ImageSource? Logo
    {
        get
        {
            if (!_logoRequested)
            {
                _logoRequested = true;
                LogoService.Instance.Request(Data.Logo, img => Logo = img);
            }
            return _logo;
        }
        set
        {
            if (SetProperty(ref _logo, value)) OnPropertyChanged(nameof(HasLogo));
        }
    }

    public bool HasLogo => _logo != null;

    public static string Normalize(string s) => TextHelpers.Normalize(s);
}

/// <summary>Elemento con locandina caricata in modo pigro (film, serie, episodi).</summary>
public abstract partial class ArtworkItem : ObservableObject
{
    private ImageSource? _art;
    private bool _artRequested;

    protected abstract string? ArtUrl { get; }

    public ImageSource? Art
    {
        get
        {
            if (!_artRequested)
            {
                _artRequested = true;
                LogoService.Instance.Request(ArtUrl, img => Art = img);
            }
            return _art;
        }
        set
        {
            if (SetProperty(ref _art, value)) OnPropertyChanged(nameof(HasArt));
        }
    }

    public bool HasArt => _art != null;

    /// <summary>0..1: quanto è stato visto. 1 = finito.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasProgress))]
    private double _progress;

    [ObservableProperty] private bool _isPlaying;
    [ObservableProperty] private bool _isTvFocused;

    public bool HasProgress => Progress > 0 && Progress < 1;
}

public sealed class Movie : ArtworkItem
{
    public Movie(VodData data)
    {
        Data = data;
        SearchKey = TextHelpers.Normalize(data.Name);
        Initials = TextHelpers.Initials(data.Name);
        Meta = TextHelpers.JoinMeta(data.Year, data.Rating > 0 ? $"★ {data.Rating.ToString("0.0", CultureInfo.InvariantCulture)}" : null);
    }

    public VodData Data { get; }
    public int StreamId => Data.StreamId;
    public string Name => Data.Name;
    public string? CategoryId => Data.CategoryId;
    public string Extension => string.IsNullOrWhiteSpace(Data.Extension) ? "mp4" : Data.Extension!;
    public string SearchKey { get; }
    public string Initials { get; }
    public string Meta { get; }
    public string Key => $"m:{StreamId}";
    protected override string? ArtUrl => Data.Poster;
}

public sealed class Series : ArtworkItem
{
    public Series(SeriesData data)
    {
        Data = data;
        SearchKey = TextHelpers.Normalize(data.Name);
        Initials = TextHelpers.Initials(data.Name);
        Meta = TextHelpers.JoinMeta(data.Year, data.Genre, data.Rating > 0 ? $"★ {data.Rating.ToString("0.0", CultureInfo.InvariantCulture)}" : null);
    }

    public SeriesData Data { get; }
    public int SeriesId => Data.SeriesId;
    public string Name => Data.Name;
    public string? CategoryId => Data.CategoryId;
    public string SearchKey { get; }
    public string Initials { get; }
    public string Meta { get; }
    public string Key => $"s:{SeriesId}";
    protected override string? ArtUrl => Data.Cover;
}

public sealed partial class Episode : ArtworkItem
{
    public required string Id { get; init; }
    public required int SeriesId { get; init; }
    public int Season { get; init; }
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public string Extension { get; init; } = "mp4";
    public int DurationSecs { get; init; }
    public string? Plot { get; init; }
    public string? Image { get; init; }

    public string Key => $"e:{Id}";
    public string Label => $"S{Season} E{Number}";
    public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? $"Episodio {Number}" : Title;
    public string DurationText => DurationSecs > 0 ? $"{Math.Max(1, (int)Math.Round(DurationSecs / 60.0))} min" : "";

    [ObservableProperty] private bool _isWatched;

    protected override string? ArtUrl => Image;
}
