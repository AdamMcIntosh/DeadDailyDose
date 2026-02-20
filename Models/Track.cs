namespace DeadDailyDose.Models;

/// <summary>
/// Represents a single audio track from a show (Internet Archive file).
/// </summary>
public class Track
{
    /// <summary>File name as stored on IA.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Human-readable title if available from metadata.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Full streaming URL for playback.</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>Display text for ListBox (e.g. "Track 1: Song Title").</summary>
    public string DisplayText => string.IsNullOrWhiteSpace(Title) ? Name : Title;
}
