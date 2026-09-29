param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$Password = 'MasterThesisOsWidgetPoc'
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\WidgetProvider\MasterThesisOs.WidgetProvider.csproj'
$certificateDirectory = Join-Path $PSScriptRoot 'Certificates'
$pfxPath = Join-Path $certificateDirectory 'MasterThesisOs.WidgetPoc.pfx'

if (-not (Test-Path -LiteralPath $pfxPath)) {
    & (Join-Path $PSScriptRoot 'New-DevCertificate.ps1') -OutputDirectory $certificateDirectory -Password $Password
}

$certificate = Get-ChildItem 'Cert:\CurrentUser\My' |
    Where-Object Subject -eq 'CN=Master Thesis OS Development' |
    Sort-Object NotBefore -Descending |
    Select-Object -First 1

if ($null -eq $certificate) {
    throw 'Signing certificate was not found in Cert:\CurrentUser\My.'
}

dotnet publish $project `
    -c $Configuration `
    -r win-x64 `
    --self-contained false `
    -p:GenerateAppxPackageOnBuild=true `
    -p:AppxPackageSigningEnabled=true `
    "-p:PackageCertificateThumbprint=$($certificate.Thumbprint)"

if ($LASTEXITCODE -ne 0) {
    throw "Package build failed with exit code $LASTEXITCODE."
}

$package = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\WidgetProvider\AppPackages') -Filter '*.msix' -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Write-Output "Package: $($package.FullName)"
