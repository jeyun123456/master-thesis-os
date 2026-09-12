using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Drawing = System.Drawing;
using Imaging = System.Windows.Interop.Imaging;
using Media = System.Windows.Media;

namespace WallpaperHostPoc;

internal static class BrandIcon
{
    internal static Drawing.Icon CreateIcon()
    {
        using var bitmap = CreateBitmap(32);
        var nativeIcon = bitmap.GetHicon();

        try
        {
            using var icon = Drawing.Icon.FromHandle(nativeIcon);
            return (Drawing.Icon)icon.Clone();
        }
        finally
        {
            _ = DestroyIcon(nativeIcon);
        }
    }

    internal static Media.ImageSource CreateImageSource()
    {
        using var icon = CreateIcon();
        var source = Imaging.CreateBitmapSourceFromHIcon(
            icon.Handle,
            System.Windows.Int32Rect.Empty,
            System.Windows.Interop.BitmapSizeOptions.FromEmptyOptions());
        source.Freeze();
        return source;
    }

    private static Drawing.Bitmap CreateBitmap(int size)
    {
        var bitmap = new Drawing.Bitmap(size, size, PixelFormat.Format32bppArgb);

        using var graphics = Drawing.Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Drawing.Color.FromArgb(15, 23, 42));

        var scale = size / 32f;
        using var pen = new Drawing.Pen(
            Drawing.Color.FromArgb(248, 250, 252),
            Math.Max(2f, 3.2f * scale))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };

        var points = new[]
        {
            new Drawing.PointF(7f * scale, 24f * scale),
            new Drawing.PointF(7f * scale, 9f * scale),
            new Drawing.PointF(16f * scale, 18f * scale),
            new Drawing.PointF(25f * scale, 9f * scale),
            new Drawing.PointF(25f * scale, 24f * scale),
        };

        graphics.DrawLines(pen, points);

        using var accent = new Drawing.SolidBrush(Drawing.Color.FromArgb(34, 211, 238));
        graphics.FillEllipse(
            accent,
            22f * scale,
            4f * scale,
            5f * scale,
            5f * scale);

        return bitmap;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(nint hIcon);
}
