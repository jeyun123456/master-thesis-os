[CmdletBinding()]
param(
    [switch]$NoLaunch,
    [switch]$DesktopShortcut
)

$ErrorActionPreference = 'Stop'

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$InstalledExe = Join-Path $AppDirectory 'MasterThesisOSWallpaper.exe'
$InstalledUninstaller = Join-Path $RootDirectory 'Uninstall-MasterThesisOSWallpaper.ps1'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'
$PublishScript = Join-Path $PSScriptRoot 'Publish-Release.ps1'
$UninstallScript = Join-Path $PSScriptRoot 'Uninstall-WallpaperHost.ps1'
$PublishDirectory = Join-Path $env:TEMP ('MasterThesisOSWallpaper-publish-' + [guid]::NewGuid().ToString('N'))

$ProgramsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$StartMenuDirectory = Join-Path $ProgramsDirectory 'Master Thesis OS'
$AppShortcut = Join-Path $StartMenuDirectory 'Master Thesis OS Wallpaper.lnk'
$UninstallShortcut = Join-Path $StartMenuDirectory 'Uninstall Master Thesis OS Wallpaper.lnk'
$DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Master Thesis OS Wallpaper.lnk'

function New-Shortcut {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = '',
        [string]$Description = ''
    )

    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($Path)
        $shortcut.TargetPath = $TargetPath
        $shortcut.Arguments = $Arguments
        $shortcut.WorkingDirectory = $WorkingDirectory
        $shortcut.IconLocation = $IconLocation
        $shortcut.Description = $Description
        $shortcut.Save()
    } finally {
        if ($null -ne $shell) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
        }
    }
}

$currentStartup = $null
try {
    $currentStartup = (Get-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction Stop).$RunValueName
} catch {
    $currentStartup = $null
}

$startupWasEnabled = -not [string]::IsNullOrWhiteSpace($currentStartup)
$desktopShortcutAlreadyExists = Test-Path $DesktopShortcutPath

try {
    Write-Host 'Stopping existing wallpaper host...'
    @('WallpaperHostPoc', 'MasterThesisOSWallpaper') | ForEach-Object {
        Get-Process -Name $_ -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500

    & $PublishScript -OutputPath $PublishDirectory

    New-Item -ItemType Directory -Path $RootDirectory -Force | Out-Null

    if (Test-Path $AppDirectory) {
        Remove-Item $AppDirectory -Recurse -Force
    }

    New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null
    Copy-Item -Path (Join-Path $PublishDirectory '*') -Destination $AppDirectory -Recurse -Force
    Copy-Item -Path $UninstallScript -Destination $InstalledUninstaller -Force

    if (-not (Test-Path $InstalledExe)) {
        throw "Installed executable was not found after copy: $InstalledExe"
    }

    if ($startupWasEnabled) {
        $startupCommand = '"' + $InstalledExe + '" --wallpaper'
        New-Item -Path $RunKeyPath -Force | Out-Null
        Set-ItemProperty -Path $RunKeyPath -Name $RunValueName -Value $startupCommand
        Write-Host 'Updated existing Start with Windows entry to the installed executable.'
    }

    New-Item -ItemType Directory -Path $StartMenuDirectory -Force | Out-Null

    New-Shortcut `
        -Path $AppShortcut `
        -TargetPath $InstalledExe `
        -Arguments '--wallpaper' `
        -WorkingDirectory $AppDirectory `
        -IconLocation ($InstalledExe + ',0') `
        -Description 'Open Master Thesis OS Wallpaper Companion'

    $powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    New-Shortcut `
        -Path $UninstallShortcut `
        -TargetPath $powershellExe `
        -Arguments ('-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledUninstaller + '"') `
        -WorkingDirectory $RootDirectory `
        -IconLocation ($InstalledExe + ',0') `
        -Description 'Uninstall Master Thesis OS Wallpaper Companion'

    if ($DesktopShortcut -or $desktopShortcutAlreadyExists) {
        New-Shortcut `
            -Path $DesktopShortcutPath `
            -TargetPath $InstalledExe `
            -Arguments '--wallpaper' `
            -WorkingDirectory $AppDirectory `
            -IconLocation ($InstalledExe + ',0') `
            -Description 'Open Master Thesis OS Wallpaper Companion'
    }

    Write-Host ''
    Write-Host 'Installed Master Thesis OS Wallpaper Companion:'
    Write-Host "  $InstalledExe"
    Write-Host ''
    Write-Host 'Start Menu shortcuts:'
    Write-Host "  $StartMenuDirectory"
    Write-Host ''
    Write-Host 'Settings and logs were preserved under:'
    Write-Host "  $RootDirectory"

    if ($DesktopShortcut -or $desktopShortcutAlreadyExists) {
        Write-Host ''
        Write-Host 'Desktop shortcut:'
        Write-Host "  $DesktopShortcutPath"
    }

    if (-not $NoLaunch) {
        Start-Process -FilePath $InstalledExe -ArgumentList '--wallpaper'
        Write-Host 'Wallpaper companion launched.'
    }
} finally {
    if (Test-Path $PublishDirectory) {
        Remove-Item $PublishDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
