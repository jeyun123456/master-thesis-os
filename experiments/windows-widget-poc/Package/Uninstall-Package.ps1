param(
    [switch]$RemoveCertificate
)

$ErrorActionPreference = 'Stop'
Get-AppxPackage -Name 'MasterThesisOs.WidgetPoc' | Remove-AppxPackage
Write-Output 'Removed package: MasterThesisOs.WidgetPoc'

if ($RemoveCertificate) {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Removing the machine-wide trusted certificate requires an elevated PowerShell window.'
    }

    Get-ChildItem 'Cert:\CurrentUser\My', 'Cert:\LocalMachine\TrustedPeople' |
        Where-Object Subject -eq 'CN=Master Thesis OS Development' |
        Remove-Item -Force
    Write-Output 'Removed development certificate from CurrentUser certificate stores.'
}
