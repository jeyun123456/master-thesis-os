[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$ProjectPath = Join-Path $ProjectDirectory 'WallpaperHostPoc.csproj'
$IconScript = Join-Path $PSScriptRoot 'Generate-AppIcon.ps1'
$RepositoryDirectory = (Resolve-Path (Join-Path $ProjectDirectory '..\..')).Path
$BridgeSourceDirectory = Join-Path $RepositoryDirectory 'local-bridge'
$BridgeRuntimeDirectoryName = 'bridge-runtime'
$BridgePackageCheckerPath = Join-Path $RepositoryDirectory 'scripts\check_bridge_package.py'
$BridgeRuntimeFiles = @(
    'bridge.py',
    'workspace_store.py',
    'bridge_config.py',
    'bridge_security.py',
    'shortcut_launcher.py',
    'thunderbird_mail.py',
    'mail_db.py',
    'mail_cli.py',
    'research_qa.py',
    'mail_jobs.py',
    'portal_db.py',
    'portal_client.py',
    'portal_cli.py',
    'portal_ai.py',
    'portal_jobs.py',
    'start_bridge.ps1'
)

$pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
$pythonExecutable = $null
$pythonPrefixArguments = @()
if ($null -ne $pythonCommand) {
    $pythonExecutable = $pythonCommand.Source
    $pythonPrefixArguments = @('-3')
} else {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand -and $pythonCommand.Source -notmatch '\\WindowsApps\\python\.exe$') {
        $pythonExecutable = $pythonCommand.Source
    }
}
if ($null -eq $pythonExecutable) {
    throw 'Python 3 is required for the offline Bridge package completeness check.'
}
& $pythonExecutable @pythonPrefixArguments -c 'import ast' *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Python 3 could not run the offline Bridge package completeness check.'
}

$sourceCommitOutput = & git -C $RepositoryDirectory rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the source Git commit for Bridge package provenance.'
}
$SourceCommit = ($sourceCommitOutput -join '').Trim()
if ($SourceCommit -notmatch '^[0-9a-f]{40}([0-9a-f]{24})?$') {
    throw 'The source Git commit is not a full SHA-1 or SHA-256 value.'
}
$gitStatus = @(& git -C $RepositoryDirectory status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect source working-tree state for Bridge provenance.'
}
$SourceTreeClean = $gitStatus.Count -eq 0

$sourceCheckArguments = @('--repo-root', $RepositoryDirectory)
& $pythonExecutable @pythonPrefixArguments $BridgePackageCheckerPath @sourceCheckArguments
if ($LASTEXITCODE -ne 0) {
    throw 'Offline Bridge source/package completeness check failed.'
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ProjectDirectory 'artifacts\publish\win-x64'
}

$desktopRuntime = dotnet --list-runtimes | Where-Object {
    $_ -match '^Microsoft\.WindowsDesktop\.App 8\.'
}

if (-not $desktopRuntime) {
    throw 'Microsoft Windows Desktop Runtime 8.x is required.'
}

& $IconScript
if ($LASTEXITCODE -ne 0) {
    throw "Application icon generation failed with exit code $LASTEXITCODE."
}

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Write-Host "Publishing Master Thesis OS Wallpaper Companion to: $OutputPath"

dotnet publish $ProjectPath `
    -c Release `
    -r win-x64 `
    --self-contained false `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    -o $OutputPath

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$exePath = Join-Path $OutputPath 'MasterThesisOSWallpaper.exe'
if (-not (Test-Path $exePath)) {
    throw "Published executable was not found: $exePath"
}

$bridgeRuntimeDirectory = Join-Path $OutputPath $BridgeRuntimeDirectoryName
New-Item -ItemType Directory -Path $bridgeRuntimeDirectory -Force | Out-Null

foreach ($bridgeFile in $BridgeRuntimeFiles) {
    $sourcePath = Join-Path $BridgeSourceDirectory $bridgeFile
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Local Bridge runtime file was not found: $sourcePath"
    }

    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $bridgeRuntimeDirectory $bridgeFile) -Force
}

$artifactCheckArguments = @(
    '--repo-root', $RepositoryDirectory,
    '--artifact-root', $bridgeRuntimeDirectory,
    '--source-commit', $SourceCommit,
    '--source-tree-clean', $(if ($SourceTreeClean) { 'true' } else { 'false' }),
    '--write-provenance'
)
& $pythonExecutable @pythonPrefixArguments $BridgePackageCheckerPath @artifactCheckArguments
if ($LASTEXITCODE -ne 0) {
    throw 'Offline Bridge artifact provenance/completeness check failed.'
}

Write-Host "Publish complete: $exePath"
Write-Host "Local Bridge runtime included: $bridgeRuntimeDirectory"
