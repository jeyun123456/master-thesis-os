param()

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifestPath = Join-Path $root 'WidgetProvider\Package.appxmanifest'
$templatePath = Join-Path $root 'WidgetProvider\Templates\MediumWidget.json'
$providerPath = Join-Path $root 'WidgetProvider\WidgetProvider.cs'

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$null = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8 | ConvertFrom-Json

$manifestText = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$providerText = Get-Content -LiteralPath $providerPath -Raw -Encoding UTF8

$requiredValues = @(
    'com.microsoft.windows.widgets',
    '3E1D8D7C-B975-4F14-9AF0-9D89A6A55F21',
    'MasterThesisOs_Medium_Widget',
    '<Size Name="medium" />'
)

foreach ($value in $requiredValues) {
    if (-not $manifestText.Contains($value)) {
        throw "Manifest is missing required value: $value"
    }
}

if (-not $providerText.Contains('3E1D8D7C-B975-4F14-9AF0-9D89A6A55F21')) {
    throw 'Provider CLSID does not match the package manifest.'
}

if (-not $providerText.Contains('MasterThesisOs_Medium_Widget')) {
    throw 'Provider definition ID does not match the package manifest.'
}

foreach ($asset in @('StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png', 'WidgetIcon.png', 'WidgetPreview.png')) {
    $assetPath = Join-Path $root "Assets\$asset"
    if (-not (Test-Path -LiteralPath $assetPath)) {
        throw "Missing package asset: $asset"
    }
}

Write-Output 'Manifest XML: valid'
Write-Output 'Adaptive Card template JSON: valid'
Write-Output 'COM CLSID and widget definition ID: consistent'
Write-Output 'Required assets: present'
