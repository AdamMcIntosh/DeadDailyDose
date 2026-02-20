using System.IO;
using System.Text.Json;

namespace DeadDailyDose;

/// <summary>
/// Persists API key and optional last show to a JSON file in AppData.
/// </summary>
public static class AppSettings
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };
    private static string SettingsPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "DeadDailyDose",
            "settings.json");

    /// <summary>Setlist.fm API key (empty until user sets it).</summary>
    public static string SetlistFmApiKey
    {
        get => Load().SetlistFmApiKey;
        set { var s = Load(); s.SetlistFmApiKey = value ?? string.Empty; Save(s); }
    }

    /// <summary>Last loaded show identifier for optional persistence.</summary>
    public static string LastShowIdentifier
    {
        get => Load().LastShowIdentifier;
        set { var s = Load(); s.LastShowIdentifier = value ?? string.Empty; Save(s); }
    }

    /// <summary>Last selected artist name for persistence.</summary>
    public static string LastArtistName
    {
        get => Load().LastArtistName;
        set { var s = Load(); s.LastArtistName = value ?? string.Empty; Save(s); }
    }

    private static SettingsData Load()
    {
        try
        {
            var dir = Path.GetDirectoryName(SettingsPath);
            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
            {
                var json = File.ReadAllText(SettingsPath);
                var data = JsonSerializer.Deserialize<SettingsData>(json);
                if (data != null) return data;
            }
        }
        catch { /* use defaults */ }
        return new SettingsData();
    }

    private static void Save(SettingsData data)
    {
        try
        {
            var dir = Path.GetDirectoryName(SettingsPath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(SettingsPath, JsonSerializer.Serialize(data, Options));
            }
        }
        catch { /* ignore */ }
    }

    private class SettingsData
    {
        public string SetlistFmApiKey { get; set; } = string.Empty;
        public string LastShowIdentifier { get; set; } = string.Empty;
        public string LastArtistName { get; set; } = string.Empty;
    }
}
