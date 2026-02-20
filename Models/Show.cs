namespace DeadDailyDose.Models;

/// <summary>
/// Represents a Grateful Dead show from Internet Archive.
/// </summary>
public class Show
{
    /// <summary>Internet Archive identifier (e.g. gd1977-05-08).</summary>
    public string Identifier { get; set; } = string.Empty;

    /// <summary>Display title of the show.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Show date in YYYY-MM-DD format.</summary>
    public string Date { get; set; } = string.Empty;

    /// <summary>True if this show was chosen at random (e.g. no date match).</summary>
    public bool IsRandom { get; set; }
}
