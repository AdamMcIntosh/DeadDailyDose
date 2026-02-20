namespace DeadDailyDose.Models;

/// <summary>
/// Represents an artist/band whose shows are available on Internet Archive and setlist.fm.
/// </summary>
public class Artist
{
    /// <summary>Display name for UI.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Internet Archive collection identifier.</summary>
    public string Collection { get; set; } = string.Empty;

    /// <summary>MusicBrainz ID for setlist.fm API queries.</summary>
    public string Mbid { get; set; } = string.Empty;

    /// <summary>Optional: when same collection is shared (e.g. JerryGarcia), filter by this keyword in identifier/title (e.g. "jgb" for JGB, null for Solo).</summary>
    public string? CollectionFilterKeyword { get; set; }

    /// <summary>If set, exclude docs whose identifier/title contains this (e.g. "jgb" for Solo to exclude JGB shows).</summary>
    public string? ExcludeKeyword { get; set; }

    public override string ToString() => Name;
}
