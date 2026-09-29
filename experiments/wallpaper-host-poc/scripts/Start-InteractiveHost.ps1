$ErrorActionPreference = 'Stop'

$exe = "$env:LOCALAPPDATA\MasterThesisOSWallpaper\app\MasterThesisOSWallpaper.exe"
$dir = "$env:LOCALAPPDATA\MasterThesisOSWallpaper\app"

if (-not (Test-Path $exe)) {
    throw "Executable not found at: $exe"
}

$desktopLnk = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) 'Master Thesis OS Wallpaper.lnk'
$startMenuLnk = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)) 'Master Thesis OS\Master Thesis OS Wallpaper.lnk'

# Find valid shortcut
$targetLnk = $null
if (Test-Path $desktopLnk) {
    $targetLnk = $desktopLnk
} elseif (Test-Path $startMenuLnk) {
    $targetLnk = $startMenuLnk
}

if ($targetLnk) {
    # Launching via explorer.exe ensures process runs in the user's interactive desktop session (WinSta0\Default)
    # allowing Shell_NotifyIcon to register with the taskbar tray and wallpaper WorkerW attachment to succeed.
    Write-Host "Launching via interactive Explorer shell: $targetLnk"
    Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$targetLnk`""
} else {
    # Fallback to Scheduled Task with explicit Interactive logon
    $action = New-ScheduledTaskAction -Execute $exe -Argument '--wallpaper' -WorkingDirectory $dir
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
    Register-ScheduledTask -TaskName "LaunchWallpaper" -Action $action -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName "LaunchWallpaper"
    Start-Sleep -Seconds 3
    Unregister-ScheduledTask -TaskName "LaunchWallpaper" -Confirm:$false
}

Start-Sleep -Seconds 3
$proc = Get-Process -Name 'MasterThesisOSWallpaper' -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "MasterThesisOSWallpaper launched successfully: PID $($proc.Id)"
    $proc | Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize
} else {
    Write-Host "Process not found after launch."
}
