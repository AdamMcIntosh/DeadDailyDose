using System.Diagnostics;
using System.Windows;
using System.Windows.Input;

namespace DeadDailyDose;

public partial class RadioWindow : Window
{
    private RadioViewModel ViewModel => (RadioViewModel)DataContext;

    public RadioWindow()
    {
        InitializeComponent();
        DataContext = new RadioViewModel();

        ViewModel.RequestPlayUrl += OnRequestPlayUrl;
        ViewModel.RequestStop    += OnRequestStop;

        VolumeSlider.ValueChanged += (_, _) => MediaElement.Volume = VolumeSlider.Value;

        Loaded  += async (_, _) =>
        {
            MediaElement.Volume = VolumeSlider.Value;
            await ViewModel.StartAsync();
        };

        Closing += (_, _) =>
        {
            ViewModel.StopRadio();
            ViewModel.RequestPlayUrl -= OnRequestPlayUrl;
            ViewModel.RequestStop    -= OnRequestStop;
        };
    }

    private void OnRequestPlayUrl(string url)
    {
        try
        {
            MediaElement.Source = new Uri(url);
            MediaElement.Play();
        }
        catch (Exception ex)
        {
            ViewModel.Status = $"Playback error: {ex.Message}";
            ViewModel.OnSongEnded();
        }
    }

    private void OnRequestStop()
    {
        MediaElement.Stop();
        MediaElement.Source = null;
    }

    private void MediaElement_MediaEnded(object sender, RoutedEventArgs e) =>
        ViewModel.OnSongEnded();

    private void MediaElement_MediaFailed(object sender, ExceptionRoutedEventArgs e) =>
        ViewModel.OnSongEnded();

    private void ArchiveLink_Click(object sender, MouseButtonEventArgs e)
    {
        var id = ViewModel.ShowIdentifier;
        if (!string.IsNullOrEmpty(id))
            Process.Start(new ProcessStartInfo(
                $"https://archive.org/details/{id}") { UseShellExecute = true });
    }
}
