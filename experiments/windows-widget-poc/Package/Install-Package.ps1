param()

$ErrorActionPreference = 'Stop'
$certificatePath = Join-Path $PSScriptRoot 'Certificates\MasterThesisOs.WidgetPoc.cer'
$packageRoot = Join-Path $PSScriptRoot '..\WidgetProvider\AppPackages'

if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw 'Development certificate not found. Run Build-Package.ps1 first.'
}

$package = Get-ChildItem -LiteralPath $packageRoot -Filter '*.msix' -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $package) {
    throw 'MSIX package not found. Run Build-Package.ps1 first.'
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
$trusted = Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' |
    Where-Object Thumbprint -eq $certificate.Thumbprint |
    Select-Object -First 1

if ($null -eq $trusted) {
    throw 'Development certificate is not trusted for MSIX. Run Trust-DevCertificate.ps1 from an elevated PowerShell window.'
}

Add-AppxPackage -Path $package.FullName -ForceUpdateFromAnyVersion
Write-Output "Installed: $($package.FullName)"
