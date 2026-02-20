namespace DeadDailyDose.Models;

/// <summary>
/// One set from a show setlist (e.g. Set 1, Set 2, Encore).
/// </summary>
public class SetlistSet
{
    /// <summary>Set name (e.g. "Set 1", "Encore").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>List of song names in order.</summary>
    public List<string> Songs { get; set; } = new();
}
