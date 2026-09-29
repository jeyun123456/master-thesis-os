param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetDirectory = $PSScriptRoot
$background = [System.Drawing.Color]::FromArgb(255, 31, 41, 55)
$accent = [System.Drawing.Color]::FromArgb(255, 96, 165, 250)
$foreground = [System.Drawing.Color]::White
$muted = [System.Drawing.Color]::FromArgb(255, 203, 213, 225)

function New-Canvas {
    param([int]$Width, [int]$Height)
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear($background)
    return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Canvas {
    param($Canvas, [string]$Name)
    $path = Join-Path $assetDirectory $Name
    $Canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Canvas.Graphics.Dispose()
    $Canvas.Bitmap.Dispose()
}

function Add-Mark {
    param($Graphics, [int]$Width, [int]$Height)
    $pen = [System.Drawing.Pen]::new($accent, [Math]::Max(3, [int]($Width * 0.07)))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $left = [int]($Width * 0.23)
    $right = [int]($Width * 0.77)
    $top = [int]($Height * 0.28)
    $bottom = [int]($Height * 0.72)
    $Graphics.DrawLine($pen, $left, $bottom, $left, $top)
    $Graphics.DrawLine($pen, $left, $top, [int]($Width * 0.5), [int]($Height * 0.55))
    $Graphics.DrawLine($pen, [int]($Width * 0.5), [int]($Height * 0.55), $right, $top)
    $Graphics.DrawLine($pen, $right, $top, $right, $bottom)
    $pen.Dispose()
}

foreach ($spec in @(
    @{ Name = 'StoreLogo.png'; Width = 50; Height = 50 },
    @{ Name = 'Square44x44Logo.png'; Width = 44; Height = 44 },
    @{ Name = 'Square150x150Logo.png'; Width = 150; Height = 150 },
    @{ Name = 'WidgetIcon.png'; Width = 64; Height = 64 }
)) {
    $canvas = New-Canvas -Width $spec.Width -Height $spec.Height
    Add-Mark -Graphics $canvas.Graphics -Width $spec.Width -Height $spec.Height
    Save-Canvas -Canvas $canvas -Name $spec.Name
}

$wide = New-Canvas -Width 310 -Height 150
Add-Mark -Graphics $wide.Graphics -Width 150 -Height 150
$wideFont = [System.Drawing.Font]::new('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$wide.Graphics.DrawString('Master Thesis OS', $wideFont, [System.Drawing.Brushes]::White, 130, 55)
$wideFont.Dispose()
Save-Canvas -Canvas $wide -Name 'Wide310x150Logo.png'

$preview = New-Canvas -Width 300 -Height 304
$g = $preview.Graphics
$title = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$heading = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$body = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Regular)
$small = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Regular)
$accentBrush = [System.Drawing.SolidBrush]::new($accent)
$mutedBrush = [System.Drawing.SolidBrush]::new($muted)
$g.DrawString('Master Thesis OS', $title, [System.Drawing.Brushes]::White, 18, 16)
$g.DrawString('Today', $heading, [System.Drawing.Brushes]::White, 18, 55)
$g.DrawString('[ ] Apply presentation feedback', $body, $mutedBrush, 18, 82)
$g.DrawString('[ ] Organize research results', $body, $mutedBrush, 18, 106)
$g.DrawString('14:30', $heading, $accentBrush, 18, 145)
$g.DrawString('Research meeting', $body, [System.Drawing.Brushes]::White, 75, 146)
$g.DrawString('Thesis progress', $heading, [System.Drawing.Brushes]::White, 18, 187)
$barBackground = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 71, 85, 105))
$g.FillRectangle($barBackground, 18, 220, 205, 10)
$g.FillRectangle($accentBrush, 18, 220, 148, 10)
$g.DrawString('72%', $small, [System.Drawing.Brushes]::White, 235, 212)
$g.DrawString('Open dashboard ->', $heading, $accentBrush, 151, 263)
$title.Dispose(); $heading.Dispose(); $body.Dispose(); $small.Dispose()
$accentBrush.Dispose(); $mutedBrush.Dispose(); $barBackground.Dispose()
Save-Canvas -Canvas $preview -Name 'WidgetPreview.png'
