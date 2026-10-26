[CmdletBinding()]
param(
    [string]$ApiTask = 'MTOS_Agent_API',
    [string]$WorkerTask = 'MTOS_Agent_Worker',
    [int]$Port = 8789
)

# Starts the agent API / worker scheduled tasks when their process is missing (for example after the
# system ran out of memory). It only ever *starts* a missing service: a running one is never stopped or
# killed, so it cannot disturb a healthy agent. Run every few minutes from Task Scheduler.
$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:LOCALAPPDATA 'MasterThesisOS\agent\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'watchdog.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 256KB) { Move-Item $log "$log.old" -Force }

function Write-Log($text) { Add-Content -LiteralPath $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $text) }

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
$hasApi = [bool]($procs | Where-Object { $_.CommandLine -match 'mtos-agent[\\/]+src[\\/]+server\.js' })
$hasWorker = [bool]($procs | Where-Object { $_.CommandLine -match 'mtos-agent[\\/]+src[\\/]+worker\.js' })
$listening = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)

# The API is considered down only when no process exists AND nothing listens on its port.
if (-not $hasApi -and -not $listening) {
    Write-Log "API missing -> starting $ApiTask"
    Start-ScheduledTask -TaskName $ApiTask
}
if (-not $hasWorker) {
    Write-Log "Worker missing -> starting $WorkerTask"
    Start-ScheduledTask -TaskName $WorkerTask
}
