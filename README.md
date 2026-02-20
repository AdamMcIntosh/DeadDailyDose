# Dead Daily Dose

A Windows desktop app for your daily dose of Grateful Dead–era live music. Pick an artist, get a **show of the day** from the Internet Archive, view the setlist (when configured), and play the show’s tracks.

## Features

- **Artists**: Grateful Dead, Jerry Garcia Band, Dead & Company
- **Show of the day**: Load a random show from the Internet Archive for the selected artist (optionally randomize artist on each refresh)
- **Setlist**: View the setlist for the current show via the [setlist.fm](https://www.setlist.fm) API (requires an API key)
- **Playback**: Play tracks from the show with play/pause, seek, and repeat modes (None, Repeat All, Repeat One)
- **Settings**: API key and last show/artist are stored in `%AppData%\DeadDailyDose\settings.json`

## Requirements

- **Windows** (WPF)
- **.NET 8 SDK** (only needed if you build from source; the release zip includes the runtime)

## Download

Pre-built Windows builds are published on [GitHub Releases](https://github.com/YOUR_USERNAME/DeadDailyDose/releases). Download the latest `DeadDailyDose.exe`, run it—no install or .NET required.

## Build & Run (from source)

```bash
# Restore and build
dotnet restore
dotnet build

# Run
dotnet run
```

Or open `DeadDailyDose.sln` in Visual Studio and run from there.

## Setlist.fm API Key (optional)

Setlist display uses the [setlist.fm API](https://api.setlist.fm/docs/). Without an API key, the app still works: you can pick an artist, load a show, and play tracks; the setlist panel is hidden.

To enable setlists:

1. Get a free API key from [setlist.fm](https://www.setlist.fm/settings/apps).
2. In the app: **File → Set API Key…** and paste the key.

The key is saved in your AppData settings and not sent anywhere except setlist.fm.

## Project structure

- **MainWindow.xaml / MainViewModel.cs** — Main UI and show/track/playback logic
- **Models/** — `Artist`, `Show`, `SetlistSet`, `Track`
- **AppSettings.cs** — Persisted API key and last show/artist
- **Themes/** — WPF styles and design tokens

## Publishing a release

The [Release workflow](.github/workflows/release.yml) builds the single-file exe and attaches it to a GitHub Release. It runs in two cases:

1. **When you push a version tag:**  
   `git tag v1.0.0` then `git push origin v1.0.0` — the workflow creates the release and uploads `DeadDailyDose.exe`.

2. **When you publish a release from the GitHub UI:**  
   On the repo’s **Releases** page, click **Create a new release**, choose an existing tag (e.g. `v1.0.0`), add notes, and click **Publish release**. The workflow runs and uploads `DeadDailyDose.exe` to that release.

If a release only shows “Source code (zip)”, the workflow may still be running or may have failed — check the **Actions** tab. Replace `YOUR_USERNAME` in the Download section with your GitHub org or username.

## License

MIT License. See [LICENSE](LICENSE).
