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
    $bitmap = New-Object -TypeName System.Drawing.Bitmap -ArgumentList $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object -TypeName System.IO.MemoryStream

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::FromArgb(15, 23, 42))

        $scale = $Size / 32.0
        $penWidth = [single][Math]::Max(2.0, 3.2 * $scale)
        $pen = New-Object -TypeName System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(248, 250, 252)), $penWidth
        $accent = New-Object -TypeName System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(34, 211, 238))

        try {
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

            $points = [System.Drawing.PointF[]]@(
                [System.Drawing.PointF]::new([single](7 * $scale), [single](24 * $scale)),
                [System.Drawing.PointF]::new([single](7 * $scale), [single](9 * $scale)),
                [System.Drawing.PointF]::new([single](16 * $scale), [single](18 * $scale)),
                [System.Drawing.PointF]::new([single](25 * $scale), [single](9 * $scale)),
                [System.Drawing.PointF]::new([single](25 * $scale), [single](24 * $scale))
            )

            $graphics.DrawLines($pen, $points)
            $graphics.FillEllipse(
                $accent,
                [single](22 * $scale),
                [single](4 * $scale),
                [single](5 * $scale),
                [single](5 * $scale))
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return ,([byte[]]$stream.ToArray())
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
    $images.Add([byte[]](New-IconPngBytes -Size $size))
}

$fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
$writer = New-Object -TypeName System.IO.BinaryWriter -ArgumentList $fileStream

try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
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
