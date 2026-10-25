[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'MasterThesisOS\bridge-runtime'),
    [switch]$NoStartupShortcut
)

# Installs the Local Bridge without the removed Wallpaper Companion.
# Bridge settings and the portal browser profile stay in the legacy
# %LOCALAPPDATA%\MasterThesisOSWallpaper folder; this script never touches it.
# Existing runtime data (data\*.db) in the destination is kept.

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeFiles = @(
    'bridge.py', 'bridge_config.py', 'bridge_security.py',
    'mail_cli.py', 'mail_db.py', 'mail_jobs.py', 'thunderbird_mail.py',
    'portal_ai.py', 'portal_cli.py', 'portal_client.py', 'portal_db.py', 'portal_jobs.py',
    'research_qa.py', 'shortcut_launcher.py', 'workspace_store.py',
    'start_bridge.ps1', 'start_bridge_tray.ps1', 'start_bridge_tray.vbs', 'start_bridge_hidden.vbs'
)

foreach ($name in $runtimeFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) {
        throw "Missing runtime file: $name"
    }
}

if ($PSCmdlet.ShouldProcess($Destination, 'Copy Local Bridge runtime')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'data') | Out-Null
    foreach ($name in $runtimeFiles) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $Destination -Force
    }
}

if (-not $NoStartupShortcut) {
    $startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    $shortcutPath = Join-Path $startup 'start_bridge_tray.vbs.lnk'
    if ($PSCmdlet.ShouldProcess($shortcutPath, 'Point Startup shortcut at the standalone bridge')) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $Destination 'start_bridge_tray.vbs'
        $shortcut.WorkingDirectory = $Destination
        $shortcut.Save()
    }
}

Write-Host "Local Bridge runtime installed at $Destination"
$tray = Join-Path $Destination 'start_bridge_tray.vbs'
Write-Host "Start it now with: wscript.exe `"$tray`""
