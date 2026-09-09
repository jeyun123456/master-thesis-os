[CmdletBinding()]
param(
    [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'
$bridgeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $bridgeDirectory 'bridge.py'
$configPath = Join-Path $bridgeDirectory 'config.json'

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Missing config.json. Copy config.example.json to config.json and edit it."
}

if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
    throw "Missing bridge.py in $bridgeDirectory."
}

function Test-PythonCommand {
    param(
        [string]$Executable,
        [string[]]$PrefixArguments
    )

    & $Executable @PrefixArguments -c 'import sys' *> $null
    return $LASTEXITCODE -eq 0
}

$pythonExecutable = $null
$pythonPrefixArguments = @()
$pythonOverride = $env:MTO_PYTHON
if ($pythonOverride -and (Test-Path -LiteralPath $pythonOverride -PathType Leaf) -and (Test-PythonCommand $pythonOverride @())) {
    $pythonExecutable = (Resolve-Path -LiteralPath $pythonOverride).Path
} else {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand -and (Test-PythonCommand $pythonCommand.Source @())) {
        $pythonExecutable = $pythonCommand.Source
    } else {
        $pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($null -ne $pythonCommand -and (Test-PythonCommand $pythonCommand.Source @('-3'))) {
            $pythonExecutable = $pythonCommand.Source
            $pythonPrefixArguments = @('-3')
        }
    }
}

if ($null -eq $pythonExecutable -and $env:LOCALAPPDATA) {
    $localPythonCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.13-64\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.12-64\python.exe')
    )
    foreach ($candidatePath in $localPythonCandidates) {
        if (Test-Path -LiteralPath $candidatePath -PathType Leaf -ErrorAction SilentlyContinue -and (Test-PythonCommand $candidatePath @())) {
            $pythonExecutable = $candidatePath
            break
        }
    }
}

if ($null -eq $pythonExecutable) {
    throw 'Python 3 was not found. Install Python and ensure python or py is on PATH.'
}

Write-Host "[bridge] running from $bridgeDirectory"
Write-Host '[bridge] close this window or press Ctrl+C to stop.'

while ($true) {
    & $pythonExecutable @pythonPrefixArguments $bridgeScript
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-Host '[bridge] stopped.'
        break
    }

    Write-Warning "[bridge] exited with code $exitCode; restarting in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds ([Math]::Max(1, $RestartDelaySeconds))
}
