[CmdletBinding()]
param(
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$InstalledExe = Join-Path $AppDirectory 'WallpaperHostPoc.exe'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'
$PublishScript = Join-Path $PSScriptRoot 'Publish-Release.ps1'
$PublishDirectory = Join-Path $env:TEMP ('MasterThesisOSWallpaper-publish-' + [guid]::NewGuid().ToString('N'))

$currentStartup = $null
try {
    $currentStartup = (Get-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction Stop).$RunValueName
} catch {
    $currentStartup = $null
}

$startupWasEnabled = -not [string]::IsNullOrWhiteSpace($currentStartup)

try {
    Write-Host 'Stopping existing wallpaper host...'
    Get-Process -Name 'WallpaperHostPoc' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400

    & $PublishScript -OutputPath $PublishDirectory

    New-Item -ItemType Directory -Path $RootDirectory -Force | Out-Null

    if (Test-Path $AppDirectory) {
        Remove-Item $AppDirectory -Recurse -Force
    }

    New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null
    Copy-Item -Path (Join-Path $PublishDirectory '*') -Destination $AppDirectory -Recurse -Force

    if (-not (Test-Path $InstalledExe)) {
        throw "Installed executable was not found after copy: $InstalledExe"
    }

    if ($startupWasEnabled) {
        $startupCommand = '"' + $InstalledExe + '" --wallpaper'
        New-Item -Path $RunKeyPath -Force | Out-Null
        Set-ItemProperty -Path $RunKeyPath -Name $RunValueName -Value $startupCommand
        Write-Host 'Updated existing Start with Windows entry to the installed executable.'
    }

    Write-Host ''
    Write-Host 'Installed Master Thesis OS Wallpaper:'
    Write-Host "  $InstalledExe"
    Write-Host ''
    Write-Host 'Settings and logs were preserved under:'
    Write-Host "  $RootDirectory"

    if (-not $NoLaunch) {
        Start-Process -FilePath $InstalledExe -ArgumentList '--wallpaper'
        Write-Host 'Wallpaper host launched.'
    }
} finally {
    if (Test-Path $PublishDirectory) {
        Remove-Item $PublishDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
