[CmdletBinding(SupportsShouldProcess = $true)]
param()

# Registers two per-user logon tasks: MTOS_Agent_API and MTOS_Agent_Worker.
# They run only while this user is logged on (Codex CLI uses this account's
# login), restart at most 3 times one minute apart after a failure, never run
# twice at once, and the worker runs at below-normal priority. Existing
# MTOS_* tasks (P0, tunnel, staging) are not touched.
$ErrorActionPreference = 'Stop'
$runner = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'run-agent.ps1'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($role in 'api', 'worker') {
    $name = if ($role -eq 'api') { 'MTOS_Agent_API' } else { 'MTOS_Agent_Worker' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Role $role"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -Priority $(if ($role -eq 'worker') { 7 } else { 5 })
    if ($PSCmdlet.ShouldProcess($name, 'Register scheduled task')) {
        Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Write-Host "registered $name"
    }
}
# Daily encrypted local backup of the agent DB (needs MTOS_BACKUP_KEY/DIR in agent.env).
# Runs after the existing 03:30 P0 backup; no Drive upload.
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Role backup"
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '03:40'
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
if ($PSCmdlet.ShouldProcess('MTOS_Agent_Backup', 'Register scheduled task')) {
    Register-ScheduledTask -TaskName 'MTOS_Agent_Backup' -Action $backupAction -Trigger $backupTrigger -Principal (New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited) -Settings $backupSettings -Force | Out-Null
    Write-Host 'registered MTOS_Agent_Backup'
}
Write-Host 'Start now with: Start-ScheduledTask MTOS_Agent_API; Start-ScheduledTask MTOS_Agent_Worker'
