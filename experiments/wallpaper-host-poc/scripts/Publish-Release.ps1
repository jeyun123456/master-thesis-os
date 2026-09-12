[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$ProjectPath = Join-Path $ProjectDirectory 'WallpaperHostPoc.csproj'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ProjectDirectory 'artifacts\publish\win-x64'
}

$desktopRuntime = dotnet --list-runtimes | Where-Object {
    $_ -match '^Microsoft\.WindowsDesktop\.App 8\.'
}

if (-not $desktopRuntime) {
    throw 'Microsoft Windows Desktop Runtime 8.x is required.'
}

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Write-Host "Publishing Master Thesis OS Wallpaper to: $OutputPath"

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

$exePath = Join-Path $OutputPath 'WallpaperHostPoc.exe'
if (-not (Test-Path $exePath)) {
    throw "Published executable was not found: $exePath"
}

Write-Host "Publish complete: $exePath"
