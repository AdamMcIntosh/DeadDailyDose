using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using DeadDailyDose.Models;

namespace DeadDailyDose;

/// <summary>Playlist repeat behavior.</summary>
public enum RepeatMode
{
    None,
    RepeatAll,
    RepeatOne
}

/// <summary>
/// ViewModel for the main window: show-of-the-day selection, setlist, tracks, and playback state.
/// </summary>
public class MainViewModel : INotifyPropertyChanged
{
    private static readonly HttpClient IaClient = new() { Timeout = TimeSpan.FromSeconds(30) };

    /// <summary>Available artists for the daily dose (Grateful Dead, JGB, Solo Jerry, Dead & Company).</summary>
    public static IReadOnlyList<Artist> Artists { get; } = new List<Artist>
    {
        new() { Name = "Grateful Dead", Collection = "GratefulDead", Mbid = "6faa7ca7-0d99-4a5e-bfa6-1fd5037520c6" },
        new() { Name = "Jerry Garcia (Solo)", Collection = "JerryGarcia", Mbid = "1ecff755-607d-4130-9a8a-8873f27e5de5", ExcludeKeyword = "jgb" },
        new() { Name = "Jerry Garcia Band", Collection = "JerryGarcia", Mbid = "6b5c16a5-9a3b-40e0-9fdb-789ab5a30f5a", CollectionFilterKeyword = "jgb" },
        new() { Name = "Dead & Company", Collection = "DeadAndCompany", Mbid = "94f8947c-2d9c-4519-bcf9-6d11a24ad006" }
    };
    private static HttpClient CreateSetlistClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        var key = AppSettings.SetlistFmApiKey;
        if (!string.IsNullOrWhiteSpace(key))
            client.DefaultRequestHeaders.Add("x-api-key", key);
        return client;
    }

    private Show? _currentShow;
    private Artist? _artistForCurrentShow;
    private Artist? _selectedArtist;
    private bool _randomizeArtistOnRefresh;
    private string _setlistText = string.Empty;
    private string _status = "Ready.";
    private bool _isLoading;
    private bool _isPlaying;
    private int _selectedTrackIndex = -1;
    private double _positionSeconds;
    private double _durationSeconds;
    private string _playPauseButtonText = "Play";
    private string _manualDateInput = string.Empty;
    private string _showOfTheDayLabel = "Show of the Day: —";
    private bool _suppressArtistChangeLoad;

    /// <summary>Current show from Internet Archive.</summary>
    public Show? CurrentShow
    {
        get => _currentShow;
        set { _currentShow = value; OnPropertyChanged(); UpdateShowLabel(); }
    }

    /// <summary>Artist used for the currently loaded show (for label and setlist).</summary>
    private Artist? ArtistForCurrentShow
    {
        get => _artistForCurrentShow;
        set { _artistForCurrentShow = value; OnPropertyChanged(); UpdateShowLabel(); }
    }

    /// <summary>Currently selected artist in the ComboBox; changing this loads shows for that artist.</summary>
    public Artist? SelectedArtist
    {
        get => _selectedArtist;
        set
        {
            if (_selectedArtist == value) return;
            _selectedArtist = value;
            OnPropertyChanged();
            if (!_suppressArtistChangeLoad && value != null)
                _ = LoadShowAsync(null);
        }
    }

    /// <summary>When true, refresh picks a random artist before loading.</summary>
    public bool RandomizeArtistOnRefresh
    {
        get => _randomizeArtistOnRefresh;
        set { _randomizeArtistOnRefresh = value; OnPropertyChanged(); }
    }

    /// <summary>Formatted setlist text for display (sets and songs).</summary>
    public string SetlistText
    {
        get => _setlistText;
        set { _setlistText = value; OnPropertyChanged(); }
    }

    /// <summary>Status line (e.g. "Playing: Bertha - 01:23 / 05:45").</summary>
    public string Status
    {
        get => _status;
        set { _status = value; OnPropertyChanged(); }
    }

    /// <summary>True while API calls are in progress.</summary>
    public bool IsLoading
    {
        get => _isLoading;
        set { _isLoading = value; OnPropertyChanged(); }
    }

    /// <summary>True when media is playing.</summary>
    public bool IsPlaying
    {
        get => _isPlaying;
        set { _isPlaying = value; PlayPauseButtonText = value ? "Pause" : "Play"; OnPropertyChanged(); }
    }

    /// <summary>Index of the selected/current track in Tracks.</summary>
    public int SelectedTrackIndex
    {
        get => _selectedTrackIndex;
        set { _selectedTrackIndex = value; OnPropertyChanged(); }
    }

    /// <summary>Current playback position in seconds (for seek slider).</summary>
    public double PositionSeconds
    {
        get => _positionSeconds;
        set { _positionSeconds = value; OnPropertyChanged(); }
    }

    /// <summary>Total duration of current track in seconds.</summary>
    public double DurationSeconds
    {
        get => _durationSeconds;
        set { _durationSeconds = value; OnPropertyChanged(); }
    }

    /// <summary>Play/Pause button content.</summary>
    public string PlayPauseButtonText
    {
        get => _playPauseButtonText;
        set { _playPauseButtonText = value; OnPropertyChanged(); }
    }

    /// <summary>Manual date input (MM-DD) for "search by date" feature.</summary>
    public string ManualDateInput
    {
        get => _manualDateInput;
        set { _manualDateInput = value; OnPropertyChanged(); }
    }

    /// <summary>Label for show of the day (e.g. "Show of the Day: 1977-05-08 - Barton Hall").</summary>
    public string ShowOfTheDayLabel
    {
        get => _showOfTheDayLabel;
        set { _showOfTheDayLabel = value; OnPropertyChanged(); }
    }

    /// <summary>True when setlist.fm API key is set; setlist UI is visible only then.</summary>
    public bool IsSetlistVisible
    {
        get => _isSetlistVisible;
        set { _isSetlistVisible = value; OnPropertyChanged(); }
    }

    private bool _isSetlistVisible;
    private RepeatMode _repeatMode = RepeatMode.None;

    /// <summary>Repeat mode: None (stop at end), RepeatAll, or RepeatOne.</summary>
    public RepeatMode RepeatMode
    {
        get => _repeatMode;
        set { _repeatMode = value; OnPropertyChanged(); }
    }

    /// <summary>All repeat modes for the repeat dropdown.</summary>
    public RepeatMode[] RepeatModeOptions => (RepeatMode[])Enum.GetValues(typeof(RepeatMode));

    /// <summary>List of artists for the ComboBox (same as static Artists).</summary>
    public IReadOnlyList<Artist> ArtistsList => Artists;

    /// <summary>List of tracks for the current show (bound to ListBox).</summary>
    public ObservableCollection<Track> Tracks { get; } = new();

    /// <summary>Refresh show (re-run selection and setlist).</summary>
    public RelayCommand RefreshCommand { get; }

    /// <summary>Open dialog to set setlist.fm API key.</summary>
    public RelayCommand SetApiKeyCommand { get; }

    /// <summary>Toggle play/pause (view syncs MediaElement).</summary>
    public RelayCommand PlayPauseCommand { get; }

    /// <summary>Stop playback.</summary>
    public RelayCommand StopCommand { get; }

    /// <summary>Select and play next track.</summary>
    public RelayCommand NextTrackCommand { get; }

    /// <summary>Select and play previous track.</summary>
    public RelayCommand PreviousTrackCommand { get; }

    /// <summary>Search by manual MM-DD and load that show.</summary>
    public RelayCommand SearchByDateCommand { get; }

    public MainViewModel()
    {
        _suppressArtistChangeLoad = true;
        try
        {
            var defaultArtist = Artists.First(a => a.Name == "Grateful Dead");
            var savedName = AppSettings.LastArtistName;
            _selectedArtist = string.IsNullOrEmpty(savedName)
                ? defaultArtist
                : Artists.FirstOrDefault(a => a.Name == savedName) ?? defaultArtist;
        }
        finally
        {
            _suppressArtistChangeLoad = false;
        }

        RefreshCommand = new RelayCommand(_ => _ = LoadShowAsync(null));
        SetApiKeyCommand = new RelayCommand(_ => RequestSetApiKey?.Invoke());
        PlayPauseCommand = new RelayCommand(_ => IsPlaying = !IsPlaying);
        StopCommand = new RelayCommand(_ => RequestStop?.Invoke());
        NextTrackCommand = new RelayCommand(_ => RequestNextTrack?.Invoke());
        PreviousTrackCommand = new RelayCommand(_ => RequestPreviousTrack?.Invoke());
        SearchByDateCommand = new RelayCommand(_ =>
        {
            var mmdd = (ManualDateInput ?? "").Trim();
            if (mmdd.Length > 0) _ = LoadShowAsync(mmdd);
        }, _ => !string.IsNullOrWhiteSpace(ManualDateInput));
    }

    /// <summary>Raised when the view should open the API key dialog.</summary>
    public event Action? RequestSetApiKey;

    /// <summary>Raised when the view should stop playback.</summary>
    public event Action? RequestStop;

    /// <summary>Raised when the view should play next track.</summary>
    public event Action? RequestNextTrack;

    /// <summary>Raised when the view should play previous track.</summary>
    public event Action? RequestPreviousTrack;

    /// <summary>Raised when a new track should be played (identifier + track index).</summary>
    public event Action<Track>? RequestPlayTrack;

    private void UpdateShowLabel()
    {
        var artistName = ArtistForCurrentShow?.Name ?? "Show";
        if (CurrentShow == null)
            ShowOfTheDayLabel = $"{artistName}: —";
        else
            ShowOfTheDayLabel = (CurrentShow.IsRandom ? $"{artistName} Random Show: " : $"{artistName} Show of the Day: ") +
                $"{CurrentShow.Date} - {CurrentShow.Title}";
    }

    /// <summary>
    /// Load show of the day (or by manual MM-DD), then metadata and setlist.
    /// </summary>
    /// <param name="manualMmDd">Optional MM-DD override (e.g. "02-20"). If null, uses current date.</param>
    public async Task LoadShowAsync(string? manualMmDd = null)
    {
        if (SelectedArtist == null)
        {
            Status = "Select an artist.";
            return;
        }

        if (RandomizeArtistOnRefresh)
        {
            _suppressArtistChangeLoad = true;
            try
            {
                _selectedArtist = Artists[Random.Shared.Next(Artists.Count)];
                OnPropertyChanged(nameof(SelectedArtist));
            }
            finally
            {
                _suppressArtistChangeLoad = false;
            }
        }

        var artist = SelectedArtist;
        IsLoading = true;
        SetlistText = string.Empty;
        RunOnUi(() => { Tracks.Clear(); SelectedTrackIndex = -1; });
        Status = "Loading…";
        try
        {
            var mmdd = manualMmDd ?? DateTime.Now.ToString("MM-dd");
            var show = await SelectShowAsync(artist, mmdd).ConfigureAwait(true);
            if (show == null)
            {
                // No show for this artist today and random fallback returned nothing — try a random artist.
                var originalArtistName = artist.Name;
                var otherArtists = Artists.Where(a => a != artist).ToList();
                if (otherArtists.Count > 0)
                {
                    var randomArtist = otherArtists[Random.Shared.Next(otherArtists.Count)];
                    show = await SelectShowAsync(randomArtist, mmdd).ConfigureAwait(true);
                    if (show != null)
                    {
                        _suppressArtistChangeLoad = true;
                        try
                        {
                            _selectedArtist = randomArtist;
                            OnPropertyChanged(nameof(SelectedArtist));
                        }
                        finally { _suppressArtistChangeLoad = false; }
                        artist = randomArtist;
                        Status = $"No {originalArtistName} show on this date; loaded random {randomArtist.Name} show. Press Play.";
                    }
                }
                if (show == null)
                {
                    Status = $"No shows found for {artist.Name}.";
                    CurrentShow = null;
                    ArtistForCurrentShow = null;
                    return;
                }
            }
            CurrentShow = show;
            ArtistForCurrentShow = artist;
            AppSettings.LastShowIdentifier = show.Identifier;
            AppSettings.LastArtistName = artist.Name;
            await LoadTracksAsync(show).ConfigureAwait(true);
            var hasSetlistKey = !string.IsNullOrWhiteSpace(AppSettings.SetlistFmApiKey);
            IsSetlistVisible = hasSetlistKey;
            if (hasSetlistKey)
                await LoadSetlistAsync(show, artist).ConfigureAwait(true);

            if (Tracks.Count == 0)
                Status = "No playable tracks found.";
            else
            {
                SelectedTrackIndex = 0;
                Status = show.IsRandom ? $"No {artist.Name} show on this date; loaded random. Press Play." : "Ready. Press Play.";
            }
        }
        catch (HttpRequestException ex)
        {
            Status = "Network error.";
            System.Windows.MessageBox.Show($"Error: {ex.Message}", "Error", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
        }
        catch (JsonException ex)
        {
            Status = "Data error.";
            System.Windows.MessageBox.Show($"Error: {ex.Message}", "Error", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
        }
        catch (Exception ex)
        {
            Status = "Error.";
            System.Windows.MessageBox.Show($"Error: {ex.Message}", "Error", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Select a show: first by date match for the artist's collection, then fallback to random.</summary>
    private async Task<Show?> SelectShowAsync(Artist artist, string mmdd)
    {
        var collection = artist.Collection;
        // Try 1: date field (e.g. date:*-02-20). IA may index as YYYY-MM-DD; wildcard can be unreliable.
        var list = await SearchShowsAsync(artist, $"collection:{collection}+AND+date:*-{mmdd}", 50).ConfigureAwait(false);
        if (list.Count == 0)
        {
            // Try 2: identifier often contains the date (e.g. gd1982-02-20.xxx). Search for month-day in identifier.
            var mmddInId = Uri.EscapeDataString(mmdd);
            list = await SearchShowsAsync(artist, $"collection:{collection}+AND+identifier:*{mmddInId}*", 100).ConfigureAwait(false);
        }
        if (list.Count > 0)
        {
            list.Sort((a, b) => string.CompareOrdinal(b.Date, a.Date));
            var first = list[0];
            return new Show
            {
                Identifier = first.Identifier,
                Title = first.Title,
                Date = first.Date,
                IsRandom = false
            };
        }

        // Fallback: random show from collection (retry with more rows if first attempt returns no docs)
        for (var rows = 1000; rows <= 5000; rows += 2000)
        {
            var showResult = await TryRandomShowFromCollectionAsync(artist, collection, rows).ConfigureAwait(false);
            if (showResult != null) return showResult;
        }
        return null;
    }

    private async Task<Show?> TryRandomShowFromCollectionAsync(Artist artist, string collection, int rows)
    {
        var url = $"https://archive.org/advancedsearch.php?q=collection:{collection}&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows={rows}&output=json";
        using var fallback = await IaClient.GetAsync(url).ConfigureAwait(false);
        fallback.EnsureSuccessStatusCode();
        var json = await fallback.Content.ReadAsStringAsync().ConfigureAwait(false);
        using var doc2 = JsonDocument.Parse(json);
        if (!doc2.RootElement.TryGetProperty("response", out var resp2) || !resp2.TryGetProperty("docs", out var docs2))
            return null;
        var allList = new List<ShowDoc>();
        foreach (var item in docs2.EnumerateArray())
            allList.Add(ShowDoc.FromElement(item));
        var filtered = FilterShowsByArtist(allList, artist);
        if (filtered.Count == 0) return null;
        var idx = Random.Shared.Next(filtered.Count);
        var doc = filtered[idx];
        return new Show
        {
            Identifier = doc.Identifier,
            Title = doc.Title,
            Date = doc.Date,
            IsRandom = true
        };
    }

    /// <summary>Run advanced search and return filtered list of show docs (empty if no results or missing structure).</summary>
    private async Task<List<ShowDoc>> SearchShowsAsync(Artist artist, string query, int rows)
    {
        var url = $"https://archive.org/advancedsearch.php?q={query}&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows={rows}&output=json";
        using var response = await IaClient.GetAsync(url).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!root.TryGetProperty("response", out var responseObj) ||
            !responseObj.TryGetProperty("docs", out var docs))
            return new List<ShowDoc>();
        var list = new List<ShowDoc>();
        foreach (var item in docs.EnumerateArray())
            list.Add(ShowDoc.FromElement(item));
        return FilterShowsByArtist(list, artist);
    }

    /// <summary>Filter docs for Jerry Garcia Solo vs JGB when sharing the same collection.</summary>
    private static List<ShowDoc> FilterShowsByArtist(List<ShowDoc> list, Artist artist)
    {
        if (list.Count == 0) return list;
        var includeKeyword = artist.CollectionFilterKeyword;
        var excludeKeyword = artist.ExcludeKeyword;
        if (string.IsNullOrEmpty(includeKeyword) && string.IsNullOrEmpty(excludeKeyword))
            return list;

        var result = new List<ShowDoc>();
        foreach (var doc in list)
        {
            var combined = $"{doc.Identifier} {doc.Title}".ToLowerInvariant();
            if (!string.IsNullOrEmpty(excludeKeyword) && combined.Contains(excludeKeyword.ToLowerInvariant()))
                continue;
            if (!string.IsNullOrEmpty(includeKeyword) && !combined.Contains(includeKeyword.ToLowerInvariant()))
                continue;
            result.Add(doc);
        }
        return result.Count > 0 ? result : list;
    }

    /// <summary>DTO for a show search hit; holds copied values so we don't keep references to a disposed JsonDocument.</summary>
    private sealed record ShowDoc(string Identifier, string Title, string Date)
    {
        public static ShowDoc FromElement(JsonElement el)
        {
            var id = el.TryGetProperty("identifier", out var idVal) ? idVal.GetString() ?? "" : "";
            var title = el.TryGetProperty("title", out var tVal) ? tVal.GetString() ?? "" : "";
            var date = el.TryGetProperty("date", out var dVal) ? dVal.GetString() ?? "" : "";
            return new ShowDoc(id, title, date);
        }
    }

    /// <summary>Fetch show metadata from IA and populate Tracks (VBR MP3, 64Kb MP3, Ogg Vorbis).</summary>
    private async Task LoadTracksAsync(Show show)
    {
        var url = $"https://archive.org/metadata/{show.Identifier}";
        using var response = await IaClient.GetAsync(url).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("files", out var files))
            return;
        var preferred = new[] { "VBR MP3", "64Kb MP3", "Ogg Vorbis" };
        var candidates = new List<(string name, string format, string title)>();

        foreach (var f in files.EnumerateArray())
        {
            var format = f.TryGetProperty("format", out var fmt) ? fmt.GetString() ?? "" : "";
            if (!preferred.Contains(format)) continue;
            var name = f.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            if (string.IsNullOrEmpty(name)) continue;
            var title = f.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            candidates.Add((name, format, title ?? ""));
        }

        var mp3First = candidates.OrderBy(c => c.format == "Ogg Vorbis" ? 1 : 0).ThenBy(c => c.name).ToList();
        var baseUrl = $"https://archive.org/download/{show.Identifier}/";
        var toAdd = mp3First.Select(t => new Track
        {
            Name = t.name,
            Title = t.title,
            Url = baseUrl + Uri.EscapeDataString(t.name)
        }).ToList();
        RunOnUi(() => { foreach (var t in toAdd) Tracks.Add(t); });
    }

    /// <summary>Run an action on the UI (Dispatcher) thread so ObservableCollection updates are valid.</summary>
    private static void RunOnUi(Action action)
    {
        var d = Application.Current?.Dispatcher;
        if (d == null || d.CheckAccess())
            action();
        else
            d.Invoke(action);
    }

    /// <summary>Fetch setlist from setlist.fm and set SetlistText. Only called when API key is set.</summary>
    private async Task LoadSetlistAsync(Show show, Artist artist)
    {
        if (string.IsNullOrWhiteSpace(AppSettings.SetlistFmApiKey))
            return;
        var dateStr = show.Date;
        if (string.IsNullOrEmpty(dateStr) || dateStr.Length < 10)
        {
            SetlistText = "No setlist available for this show.";
            return;
        }
        if (dateStr.Length == 10 && dateStr[4] == '-' && dateStr[7] == '-')
        {
            var parts = dateStr.Split('-');
            if (parts.Length == 3)
                dateStr = $"{parts[2]}-{parts[1]}-{parts[0]}";
        }

        using var client = CreateSetlistClient();
        var url = $"https://api.setlist.fm/rest/1.0/search/setlists?artistMbid={artist.Mbid}&date={dateStr}";
        using var response = await client.GetAsync(url).ConfigureAwait(false);

        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            SetlistText = "Setlist.fm API key invalid. Use 'Set API Key' from the menu.";
            return;
        }

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("setlist", out var setlistArr) || setlistArr.GetArrayLength() == 0)
        {
            SetlistText = "No setlist available for this show.";
            return;
        }

        var firstSetlist = setlistArr[0];
        if (!firstSetlist.TryGetProperty("sets", out var setsObj))
        {
            SetlistText = "No setlist available for this show.";
            return;
        }

        var sb = new System.Text.StringBuilder();
        if (setsObj.TryGetProperty("set", out var setArr))
        {
            foreach (var setEl in setArr.EnumerateArray())
            {
                var setName = setEl.TryGetProperty("name", out var sn) ? sn.GetString() ?? "Set" : "Set";
                sb.AppendLine();
                sb.AppendLine(setName + ":");
                if (setEl.TryGetProperty("song", out var songArr))
                {
                    foreach (var song in songArr.EnumerateArray())
                    {
                        var songName = song.TryGetProperty("name", out var sname) ? sname.GetString() ?? "" : "";
                        if (!string.IsNullOrEmpty(songName)) sb.AppendLine("• " + songName);
                    }
                }
            }
        }

        SetlistText = sb.Length > 0 ? sb.ToString().Trim() : "No setlist available for this show.";
    }

    /// <summary>Called by the view when user selects a track to play.</summary>
    public void OnTrackSelected(Track? track)
    {
        if (track == null) return;
        RequestPlayTrack?.Invoke(track);
    }

    /// <summary>Called by the view when playback position/duration change.</summary>
    public void UpdatePlaybackState(double positionSeconds, double durationSeconds, string trackTitle)
    {
        PositionSeconds = positionSeconds;
        DurationSeconds = durationSeconds;
        var pos = TimeSpan.FromSeconds(positionSeconds);
        var dur = TimeSpan.FromSeconds(durationSeconds);
        Status = $"Playing: {trackTitle} - {pos:mm\\:ss} / {dur:mm\\:ss}";
    }

    /// <summary>Re-fetch setlist for current show (e.g. after user sets API key).</summary>
    public async Task RefreshSetlistAsync()
    {
        if (CurrentShow == null || _artistForCurrentShow == null) return;
        IsLoading = true;
        try { await LoadSetlistAsync(CurrentShow, _artistForCurrentShow).ConfigureAwait(true); }
        finally { IsLoading = false; }
    }

    /// <summary>Shows the setlist UI (e.g. after user enters API key via menu).</summary>
    public void ShowSetlistSection()
    {
        IsSetlistVisible = !string.IsNullOrWhiteSpace(AppSettings.SetlistFmApiKey);
    }

    /// <summary>Called when playback is stopped.</summary>
    public void OnPlaybackStopped()
    {
        IsPlaying = false;
        Status = "Stopped.";
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    protected void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
