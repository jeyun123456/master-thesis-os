[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('api', 'worker', 'backup')][string]$Role,
    [string]$EnvFile = (Join-Path $env:LOCALAPPDATA 'MasterThesisOS\agent\agent.env')
)

# Launches the agent API or worker with settings from a per-user env file
# (KEY=VALUE lines). The file holds secrets, so keep it outside the repo and
# readable only by this Windows account. Values are never echoed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
        if ($line -match '^\s*(#|$)') { continue }
        $pair = $line -split '=', 2
        if ($pair.Count -eq 2 -and $pair[0].Trim() -match '^[A-Z][A-Z0-9_]*$') {
            [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), 'Process')
        }
    }
}
if (-not $env:MTOS_AGENT_DB_PATH) {
    $env:MTOS_AGENT_DB_PATH = Join-Path $env:LOCALAPPDATA 'MasterThesisOS\agent\data\mtos-agent.db'
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$script = switch ($Role) { 'api' { 'src\server.js' } 'worker' { 'src\worker.js' } 'backup' { 'scripts\backup-cli.js' } }
$logDir = Join-Path $env:LOCALAPPDATA 'MasterThesisOS\agent\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$Role.log"

# Exit code propagates so Task Scheduler's restart-on-failure applies.
$extra = if ($Role -eq 'backup') { @('backup') } else { @() }
& $node (Join-Path $root $script) @extra *>> $log
exit $LASTEXITCODE
