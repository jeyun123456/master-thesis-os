param()

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $argumentList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
    if ($elevated.ExitCode -ne 0) {
        throw "Elevated certificate trust step failed with exit code $($elevated.ExitCode)."
    }
    return
}

$certificatePath = Join-Path $PSScriptRoot 'Certificates\MasterThesisOs.WidgetPoc.cer'
if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw 'Development certificate not found. Run Build-Package.ps1 first.'
}

Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
Write-Output 'Trusted the development certificate in LocalMachine\TrustedPeople.'
