using System.ComponentModel;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using DeadDailyDose.Models;

namespace DeadDailyDose;

public class RadioViewModel : INotifyPropertyChanged
{
    private static readonly HttpClient IaClient = new() { Timeout = TimeSpan.FromSeconds(30) };

    private static readonly (string Name, string Collection, string? FilterKeyword)[] Artists =
    [
        ("Grateful Dead",     "GratefulDead",   null),
        ("Jerry Garcia Band", "JerryGarcia",    "jgb"),
        ("Dead & Company",    "DeadAndCompany", null),
    ];

    private string _artistName     = string.Empty;
    private string _showInfo       = string.Empty;
    private string _showIdentifier = string.Empty;
    private string _trackName      = string.Empty;
    private string _status         = "Starting…";
    private bool   _isLoading;
    private bool   _isRadioActive  = true;
    private CancellationTokenSource _cts = new();

    public string ArtistName     { get => _artistName;     set { _artistName = value;     OnPropertyChanged(); } }
    public string ShowInfo       { get => _showInfo;       set { _showInfo = value;       OnPropertyChanged(); } }
    public string ShowIdentifier { get => _showIdentifier; set { _showIdentifier = value; OnPropertyChanged(); } }
    public string TrackName      { get => _trackName;      set { _trackName = value;      OnPropertyChanged(); } }
    public string Status         { get => _status;         set { _status = value;         OnPropertyChanged(); } }
    public bool   IsLoading      { get => _isLoading;      set { _isLoading = value;      OnPropertyChanged(); } }
    public bool   IsRadioActive  { get => _isRadioActive;  set { _isRadioActive = value;  OnPropertyChanged(); } }

    public RelayCommand SkipSongCommand { get; }
    public RelayCommand StopCommand     { get; }

    public event Action<string>? RequestPlayUrl;
    public event Action?         RequestStop;

    public RadioViewModel()
    {
        SkipSongCommand = new RelayCommand(_ => Skip(),     _ => IsRadioActive && !IsLoading);
        StopCommand     = new RelayCommand(_ => StopRadio(), _ => IsRadioActive);
    }

    public Task StartAsync()
    {
        _cts = new CancellationTokenSource();
        return LoadRandomSongAsync(_cts.Token);
    }

    public void OnSongEnded()
    {
        if (!IsRadioActive) return;
        _cts = new CancellationTokenSource();
        Status = "Loading next song…";
        _ = LoadRandomSongAsync(_cts.Token);
    }

    private void Skip()
    {
        _cts.Cancel();
        _cts = new CancellationTokenSource();
        RequestStop?.Invoke();
        _ = LoadRandomSongAsync(_cts.Token);
    }

    public void StopRadio()
    {
        _cts.Cancel();
        IsRadioActive = false;
        IsLoading     = false;
        Status        = "Stopped.";
        RequestStop?.Invoke();
    }

    private async Task LoadRandomSongAsync(CancellationToken ct)
    {
        IsLoading = true;
        Status    = "Tuning in…";

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var artist = Artists[Random.Shared.Next(Artists.Length)];
                var show   = await GetRandomShowAsync(artist, ct);
                if (show == null) { Status = "Searching…"; await Task.Delay(2000, ct); continue; }

                Status = "Loading tracks…";
                var (tracks, venue) = await LoadTracksAndMetaAsync(show.Identifier, ct);
                if (tracks.Count == 0) { Status = "No playable tracks — skipping…"; await Task.Delay(1500, ct); continue; }

                var track = tracks[Random.Shared.Next(tracks.Count)];

                ArtistName = artist.Name;

                var parts = new List<string>();
                if (!string.IsNullOrEmpty(show.Date))  parts.Add(show.Date);
                if (!string.IsNullOrEmpty(venue))       parts.Add(venue);
                else if (!string.IsNullOrEmpty(show.Title) && show.Title != show.Identifier)
                    parts.Add(show.Title);
                ShowInfo       = string.Join(" · ", parts);
                ShowIdentifier = show.Identifier;
                TrackName      = track.DisplayText;
                Status         = string.Empty;

                RequestPlayUrl?.Invoke(track.Url);
                break;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception)
        {
            if (!ct.IsCancellationRequested)
            {
                Status = "Network error — retrying…";
                await Task.Delay(4000, CancellationToken.None);
                if (IsRadioActive && !ct.IsCancellationRequested)
                    _ = LoadRandomSongAsync(_cts.Token);
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    // -------------------------------------------------------------------------
    // IA helpers
    // -------------------------------------------------------------------------
    private async Task<RadioShowDoc?> GetRandomShowAsync(
        (string Name, string Collection, string? FilterKeyword) artist, CancellationToken ct)
    {
        foreach (var rows in new[] { 1000, 3000, 5000 })
        {
            var show = await TryCollectionAsync(artist, rows, ct);
            if (show != null) return show;
        }
        if (artist.FilterKeyword != null)
            return await TryByKeywordAsync(artist, ct);
        return null;
    }

    private async Task<RadioShowDoc?> TryCollectionAsync(
        (string Name, string Collection, string? FilterKeyword) artist, int rows, CancellationToken ct)
    {
        var url = $"https://archive.org/advancedsearch.php?q=collection:{artist.Collection}" +
                  $"&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows={rows}&output=json";
        using var resp = await IaClient.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return null;
        using var doc  = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var docs = ParseShowDocs(doc.RootElement);
        var list = FilterDocs(docs, artist.FilterKeyword);
        return list.Count == 0 ? null : list[Random.Shared.Next(list.Count)];
    }

    private async Task<RadioShowDoc?> TryByKeywordAsync(
        (string Name, string Collection, string? FilterKeyword) artist, CancellationToken ct)
    {
        var url = $"https://archive.org/advancedsearch.php?q=identifier:*{artist.FilterKeyword}*" +
                  $"&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=500&output=json";
        using var resp = await IaClient.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return null;
        using var doc  = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var docs = ParseShowDocs(doc.RootElement);
        var list = FilterDocs(docs, artist.FilterKeyword);
        return list.Count == 0 ? null : list[Random.Shared.Next(list.Count)];
    }

    private async Task<(List<Track> tracks, string venue)> LoadTracksAndMetaAsync(
        string identifier, CancellationToken ct)
    {
        var url = $"https://archive.org/metadata/{identifier}";
        using var resp = await IaClient.GetAsync(url, ct);
        resp.EnsureSuccessStatusCode();
        using var doc  = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;

        var venue = string.Empty;
        if (root.TryGetProperty("metadata", out var meta))
        {
            if      (meta.TryGetProperty("venue",    out var v)) venue = v.GetString() ?? string.Empty;
            else if (meta.TryGetProperty("coverage", out var c)) venue = c.GetString() ?? string.Empty;
        }

        if (!root.TryGetProperty("files", out var files))
            return ([], venue);

        // Use highest-quality format available; return all tracks in that format so we can pick one.
        foreach (var format in new[] { "VBR MP3", "64Kb MP3", "Ogg Vorbis" })
        {
            var candidates = new List<Track>();
            foreach (var f in files.EnumerateArray())
            {
                var fmt   = f.TryGetProperty("format", out var fv)  ? fv.GetString()  ?? "" : "";
                var name  = f.TryGetProperty("name",   out var nv)  ? nv.GetString()  ?? "" : "";
                var title = f.TryGetProperty("title",  out var tv)  ? tv.GetString()  ?? "" : "";
                if (fmt == format && !string.IsNullOrEmpty(name))
                    candidates.Add(new Track
                    {
                        Name  = name,
                        Title = title,
                        Url   = $"https://archive.org/download/{identifier}/{Uri.EscapeDataString(name)}"
                    });
            }
            if (candidates.Count > 0) return (candidates, venue);
        }

        return ([], venue);
    }

    private static List<RadioShowDoc> ParseShowDocs(JsonElement root)
    {
        var list = new List<RadioShowDoc>();
        if (!TryGet(root, "response", out var resp) || !TryGet(resp, "docs", out var docs))
            return list;
        foreach (var d in docs.EnumerateArray())
        {
            var id = Str(d, "identifier");
            if (!string.IsNullOrEmpty(id))
                list.Add(new RadioShowDoc(id, Str(d, "title"), Str(d, "date")));
        }
        return list;
    }

    private static bool TryGet(JsonElement el, string name, out JsonElement child)
    {
        child = default;
        foreach (var p in el.EnumerateObject())
            if (p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) { child = p.Value; return true; }
        return false;
    }

    private static string Str(JsonElement el, string name) =>
        el.TryGetProperty(name, out var v) ? v.GetString() ?? string.Empty : string.Empty;

    private static List<RadioShowDoc> FilterDocs(List<RadioShowDoc> docs, string? keyword)
    {
        if (string.IsNullOrEmpty(keyword)) return docs;
        var filtered = docs.Where(d =>
            $"{d.Identifier} {d.Title}".Contains(keyword, StringComparison.OrdinalIgnoreCase)).ToList();
        return filtered.Count > 0 ? filtered : docs;
    }

    private sealed record RadioShowDoc(string Identifier, string Title, string Date);

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? p = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(p));
}
