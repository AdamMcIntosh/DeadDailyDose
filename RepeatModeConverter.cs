using System.Globalization;
using System.Windows.Data;

namespace DeadDailyDose;

/// <summary>Converts <see cref="RepeatMode"/> to display string for the repeat dropdown.</summary>
public sealed class RepeatModeConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is RepeatMode mode
            ? mode switch
            {
                RepeatMode.None => "None",
                RepeatMode.RepeatAll => "Repeat All",
                RepeatMode.RepeatOne => "Repeat One",
                _ => value.ToString() ?? ""
            }
            : "";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotImplementedException();
}
