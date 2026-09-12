[CmdletBinding()]
param(
    [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'

Get-Process -Name 'WallpaperHostPoc' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

try {
    Remove-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction SilentlyContinue
} catch {
    # Best effort during uninstall.
}

if (Test-Path $AppDirectory) {
    Remove-Item $AppDirectory -Recurse -Force
}

if ($PurgeData -and (Test-Path $RootDirectory)) {
    Remove-Item $RootDirectory -Recurse -Force
    Write-Host 'Uninstalled app and removed settings/logs.'
} else {
    Write-Host 'Uninstalled app. Settings/logs were preserved.'
    Write-Host "Data directory: $RootDirectory"
}
