[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ProjectDirectory 'Assets\MasterThesisOSWallpaper.ico'
}

$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function New-IconPngBytes([int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object System.IO.MemoryStream

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::FromArgb(15, 23, 42))

        $scale = $Size / 32.0
        $penWidth = [Math]::Max(2.0, 3.2 * $scale)
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(248, 250, 252)), $penWidth
        $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 211, 238))

        try {
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

            $points = [System.Drawing.PointF[]]@(
                [System.Drawing.PointF]::new(7 * $scale, 24 * $scale),
                [System.Drawing.PointF]::new(7 * $scale, 9 * $scale),
                [System.Drawing.PointF]::new(16 * $scale, 18 * $scale),
                [System.Drawing.PointF]::new(25 * $scale, 9 * $scale),
                [System.Drawing.PointF]::new(25 * $scale, 24 * $scale)
            )

            $graphics.DrawLines($pen, $points)
            $graphics.FillEllipse($accent, 22 * $scale, 4 * $scale, 5 * $scale, 5 * $scale)
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return $stream.ToArray()
        } finally {
            $pen.Dispose()
            $accent.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
        $stream.Dispose()
    }
}

$sizes = @(16, 32, 48, 256)
$images = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($size in $sizes) {
    $images.Add((New-IconPngBytes -Size $size))
}

$fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter $fileStream

try {
    $writer.Write([UInt16]0) # reserved
    $writer.Write([UInt16]1) # icon
    $writer.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        $size = $sizes[$index]
        $bytes = $images[$index]
        $dimension = if ($size -ge 256) { [byte]0 } else { [byte]$size }

        $writer.Write($dimension)
        $writer.Write($dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$bytes.Length)
        $writer.Write([UInt32]$offset)

        $offset += $bytes.Length
    }

    foreach ($bytes in $images) {
        $writer.Write($bytes)
    }
} finally {
    $writer.Dispose()
    $fileStream.Dispose()
}

Write-Host "Generated application icon: $OutputPath"
