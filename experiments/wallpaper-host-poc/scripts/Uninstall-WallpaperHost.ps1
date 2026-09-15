[CmdletBinding()]
param(
    [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$InstalledBridgeRuntimeDirectory = Join-Path $AppDirectory 'bridge-runtime'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'

$ProgramsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$StartMenuDirectory = Join-Path $ProgramsDirectory 'Master Thesis OS'
$DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Master Thesis OS Wallpaper.lnk'

function Stop-InstalledBridgeRuntime {
    param(
        [Parameter(Mandatory=$true)][string]$RuntimeDirectory
    )

    $runtimePattern = [regex]::Escape([IO.Path]::GetFullPath($RuntimeDirectory))
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $bridgeProcesses = @(
            Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.ProcessId -ne $PID -and
                    -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
                    $_.CommandLine -match $runtimePattern
                }
        )

        if ($bridgeProcesses.Count -eq 0) {
            return
        }

        foreach ($bridgeProcess in $bridgeProcesses) {
            Stop-Process -Id $bridgeProcess.ProcessId -Force -ErrorAction SilentlyContinue
        }

        Start-Sleep -Milliseconds 250
    }
}

Write-Host 'Stopping Master Thesis OS Wallpaper Companion...'
$existingHosts = @(
    Get-Process -Name WallpaperHostPoc,MasterThesisOSWallpaper -ErrorAction SilentlyContinue
)

foreach ($hostProcess in $existingHosts) {
    try {
        [void]$hostProcess.CloseMainWindow()
    } catch {
        # The process may exit between enumeration and the close request.
    }
}

foreach ($hostProcess in $existingHosts) {
    try {
        [void]$hostProcess.WaitForExit(4000)
    } catch {
        # The process may already have exited.
    }
}

$remainingHosts = @(
    Get-Process -Name WallpaperHostPoc,MasterThesisOSWallpaper -ErrorAction SilentlyContinue
)
if ($remainingHosts.Count -gt 0) {
    $remainingHosts | Stop-Process -Force -ErrorAction SilentlyContinue
}

Stop-InstalledBridgeRuntime -RuntimeDirectory $InstalledBridgeRuntimeDirectory

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
