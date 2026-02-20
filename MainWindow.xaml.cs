using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using DeadDailyDose.Models;

namespace DeadDailyDose;

/// <summary>
/// Main window: binds to MainViewModel, hosts MediaElement and playback timer.
/// </summary>
public partial class MainWindow : Window
{
    private MainViewModel ViewModel => (MainViewModel)DataContext;
    private DispatcherTimer? _positionTimer;
    private bool _seekSliderDragging;
    private bool _skipNextSelectionPlay;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel();
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;

        ViewModel.RequestSetApiKey += OnRequestSetApiKey;
        ViewModel.RequestStop += OnRequestStop;
        ViewModel.RequestNextTrack += OnRequestNextTrack;
        ViewModel.RequestPreviousTrack += OnRequestPreviousTrack;
        ViewModel.RequestPlayTrack += OnRequestPlayTrack;

        _positionTimer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromMilliseconds(500)
        };
        _positionTimer.Tick += PositionTimer_Tick;

        SyncVolumeToMediaElement();
        VolumeSlider.ValueChanged += (_, _) => SyncVolumeToMediaElement();
    }

    private void SyncVolumeToMediaElement()
    {
        MediaElement.Volume = Math.Clamp((double)VolumeSlider.Value, 0, 1);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        SyncVolumeToMediaElement();
        if (ArtistComboBox.SelectedItem == null && ViewModel.SelectedArtist != null)
            ArtistComboBox.SelectedItem = ViewModel.SelectedArtist;
        await ViewModel.LoadShowAsync();
        if (ViewModel.Tracks.Count > 0)
        {
            _skipNextSelectionPlay = true;
            TracksListBox.SelectedIndex = 0;
        }
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        MediaElement.Stop();
        _positionTimer?.Stop();
        ViewModel.RequestSetApiKey -= OnRequestSetApiKey;
        ViewModel.RequestStop -= OnRequestStop;
        ViewModel.RequestNextTrack -= OnRequestNextTrack;
        ViewModel.RequestPreviousTrack -= OnRequestPreviousTrack;
        ViewModel.RequestPlayTrack -= OnRequestPlayTrack;
    }

    private async void OnRequestSetApiKey()
    {
        var dialog = new ApiKeyDialog();
        if (dialog.ShowDialog() == true && !string.IsNullOrWhiteSpace(dialog.ApiKey))
        {
            AppSettings.SetlistFmApiKey = dialog.ApiKey.Trim();
            ViewModel.ShowSetlistSection();
            if (ViewModel.CurrentShow != null)
                await ViewModel.RefreshSetlistAsync();
        }
    }

    private void OnRequestStop()
    {
        MediaElement.Stop();
        MediaElement.Source = null;
        _positionTimer?.Stop();
        ViewModel.OnPlaybackStopped();
    }

    private void OnRequestNextTrack()
    {
        if (ViewModel.Tracks.Count == 0 || ViewModel.SelectedTrackIndex >= ViewModel.Tracks.Count - 1) return;
        ViewModel.SelectedTrackIndex++;
        var track = ViewModel.Tracks[ViewModel.SelectedTrackIndex];
        PlayTrack(track);
    }

    private void OnRequestPreviousTrack()
    {
        if (ViewModel.Tracks.Count == 0 || ViewModel.SelectedTrackIndex <= 0) return;
        ViewModel.SelectedTrackIndex--;
        var track = ViewModel.Tracks[ViewModel.SelectedTrackIndex];
        PlayTrack(track);
    }

    private void OnRequestPlayTrack(Track track)
    {
        PlayTrack(track);
    }

    private void PlayTrack(Track track)
    {
        try
        {
            SyncVolumeToMediaElement();
            MediaElement.Source = new Uri(track.Url);
            MediaElement.Play();
            ViewModel.IsPlaying = true;
            _positionTimer?.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Playback error: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void PlayPauseButton_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.IsPlaying)
            MediaElement.Pause();
        else if (MediaElement.Source == null && ViewModel.SelectedTrackIndex >= 0 && ViewModel.SelectedTrackIndex < ViewModel.Tracks.Count)
            PlayTrack(ViewModel.Tracks[ViewModel.SelectedTrackIndex]);
        else
            MediaElement.Play();
    }

    private void TracksListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_skipNextSelectionPlay)
        {
            _skipNextSelectionPlay = false;
            if (TracksListBox.SelectedIndex >= 0)
                ViewModel.SelectedTrackIndex = TracksListBox.SelectedIndex;
            return;
        }
        if (TracksListBox.SelectedItem is Track track)
        {
            ViewModel.SelectedTrackIndex = ViewModel.Tracks.IndexOf(track);
            PlayTrack(track);
        }
    }

    private void MediaElement_MediaOpened(object sender, RoutedEventArgs e)
    {
        if (MediaElement.NaturalDuration.HasTimeSpan)
        {
            SeekSlider.Maximum = MediaElement.NaturalDuration.TimeSpan.TotalSeconds;
            SeekSlider.Value = 0;
        }
    }

    private void MediaElement_MediaEnded(object sender, RoutedEventArgs e)
    {
        if (ViewModel.Tracks.Count == 0) return;
        var mode = ViewModel.RepeatMode;
        if (mode == RepeatMode.RepeatOne && ViewModel.SelectedTrackIndex >= 0)
        {
            PlayTrack(ViewModel.Tracks[ViewModel.SelectedTrackIndex]);
            return;
        }
        if (ViewModel.SelectedTrackIndex < ViewModel.Tracks.Count - 1)
        {
            ViewModel.SelectedTrackIndex++;
            PlayTrack(ViewModel.Tracks[ViewModel.SelectedTrackIndex]);
            TracksListBox.SelectedIndex = ViewModel.SelectedTrackIndex;
            return;
        }
        if (mode == RepeatMode.RepeatAll)
        {
            ViewModel.SelectedTrackIndex = 0;
            PlayTrack(ViewModel.Tracks[0]);
            TracksListBox.SelectedIndex = 0;
            return;
        }
        _positionTimer?.Stop();
        ViewModel.IsPlaying = false;
        ViewModel.Status = "Finished.";
    }

    private void PositionTimer_Tick(object? sender, EventArgs e)
    {
        if (_seekSliderDragging || !MediaElement.NaturalDuration.HasTimeSpan) return;
        var pos = MediaElement.Position.TotalSeconds;
        var dur = MediaElement.NaturalDuration.TimeSpan.TotalSeconds;
        SeekSlider.Maximum = dur;
        SeekSlider.Value = pos;
        var title = ViewModel.Tracks.Count > 0 && ViewModel.SelectedTrackIndex >= 0 && ViewModel.SelectedTrackIndex < ViewModel.Tracks.Count
            ? ViewModel.Tracks[ViewModel.SelectedTrackIndex].DisplayText
            : "";
        ViewModel.UpdatePlaybackState(pos, dur, title);
    }

    private void SeekSlider_MouseDown(object sender, MouseButtonEventArgs e) => _seekSliderDragging = true;
    private void SeekSlider_MouseUp(object sender, MouseButtonEventArgs e)
    {
        _seekSliderDragging = false;
        if (MediaElement.Source != null && SeekSlider.Maximum > 0)
            MediaElement.Position = TimeSpan.FromSeconds(SeekSlider.Value);
    }

    private void SeekSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_seekSliderDragging && MediaElement.Source != null && SeekSlider.IsMouseCaptureWithin)
            MediaElement.Position = TimeSpan.FromSeconds(SeekSlider.Value);
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => Close();
}
