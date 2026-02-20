using System.Windows;

namespace DeadDailyDose;

/// <summary>
/// Dialog for entering or updating the setlist.fm API key.
/// </summary>
public partial class ApiKeyDialog : Window
{
    /// <summary>The entered API key (after OK).</summary>
    public string ApiKey => ApiKeyTextBox.Text;

    public ApiKeyDialog()
    {
        InitializeComponent();
        ApiKeyTextBox.Text = AppSettings.SetlistFmApiKey;
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
