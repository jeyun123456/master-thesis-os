[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Node22Exe,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nextNode = (Resolve-Path -LiteralPath $Node22Exe).Path
$nodeVersion = & $nextNode --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw 'Next.js must be started with Node 22.x. No processes were started.'
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
  throw "Local port $Port is already in use. No process was started."
}

Push-Location $repoRoot
try {
  & $nextNode 'ops/staging/staging-doctor.mjs' '--preflight'
  if ($LASTEXITCODE -ne 0) {
    throw 'Staging preflight is blocked. Review the named checks; no Next.js process was started.'
  }
  & $nextNode 'node_modules/next/dist/bin/next' 'start' '--hostname' '127.0.0.1' '--port' "$Port"
  if ($LASTEXITCODE -ne 0) {
    throw 'Next.js staging server stopped with an error.'
  }
} finally {
  Pop-Location
}
