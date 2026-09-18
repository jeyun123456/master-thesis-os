[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$ProjectPath = Join-Path $ProjectDirectory 'WallpaperHostPoc.csproj'
$IconScript = Join-Path $PSScriptRoot 'Generate-AppIcon.ps1'
$RepositoryDirectory = (Resolve-Path (Join-Path $ProjectDirectory '..\..')).Path
$BridgeSourceDirectory = Join-Path $RepositoryDirectory 'local-bridge'
$BridgeRuntimeDirectoryName = 'bridge-runtime'
$BridgeRuntimeFiles = @(
    'bridge.py',
    'bridge_config.py',
    'bridge_security.py',
    'shortcut_launcher.py',
    'thunderbird_mail.py',
    'mail_db.py',
    'mail_cli.py',
    'start_bridge.ps1'
)

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ProjectDirectory 'artifacts\publish\win-x64'
}

$desktopRuntime = dotnet --list-runtimes | Where-Object {
    $_ -match '^Microsoft\.WindowsDesktop\.App 8\.'
}

if (-not $desktopRuntime) {
    throw 'Microsoft Windows Desktop Runtime 8.x is required.'
}

& $IconScript
if ($LASTEXITCODE -ne 0) {
    throw "Application icon generation failed with exit code $LASTEXITCODE."
}

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Write-Host "Publishing Master Thesis OS Wallpaper Companion to: $OutputPath"

dotnet publish $ProjectPath `
    -c Release `
    -r win-x64 `
    --self-contained false `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    -o $OutputPath

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$exePath = Join-Path $OutputPath 'MasterThesisOSWallpaper.exe'
if (-not (Test-Path $exePath)) {
    throw "Published executable was not found: $exePath"
}

$bridgeRuntimeDirectory = Join-Path $OutputPath $BridgeRuntimeDirectoryName
New-Item -ItemType Directory -Path $bridgeRuntimeDirectory -Force | Out-Null

foreach ($bridgeFile in $BridgeRuntimeFiles) {
    $sourcePath = Join-Path $BridgeSourceDirectory $bridgeFile
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Local Bridge runtime file was not found: $sourcePath"
    }

    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $bridgeRuntimeDirectory $bridgeFile) -Force
}

Write-Host "Publish complete: $exePath"
Write-Host "Local Bridge runtime included: $bridgeRuntimeDirectory"
