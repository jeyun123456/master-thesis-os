[CmdletBinding()]
param(
    [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'

$ProgramsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$StartMenuDirectory = Join-Path $ProgramsDirectory 'Master Thesis OS'
$DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Master Thesis OS Wallpaper.lnk'

Write-Host 'Stopping Master Thesis OS Wallpaper Companion...'
@('WallpaperHostPoc', 'MasterThesisOSWallpaper') | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

try {
    Remove-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction SilentlyContinue
} catch {
    # Best effort during uninstall.
}

if (Test-Path $StartMenuDirectory) {
    Remove-Item $StartMenuDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $DesktopShortcutPath) {
    Remove-Item $DesktopShortcutPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $AppDirectory) {
    Remove-Item $AppDirectory -Recurse -Force
}

if ($PurgeData -and (Test-Path $RootDirectory)) {
    Remove-Item $RootDirectory -Recurse -Force
    Write-Host 'Uninstalled companion and removed settings/logs.'
} else {
    Write-Host 'Uninstalled companion. Settings/logs were preserved.'
    Write-Host "Data directory: $RootDirectory"
    Write-Host 'Use -PurgeData to remove preserved settings/logs as well.'
}
