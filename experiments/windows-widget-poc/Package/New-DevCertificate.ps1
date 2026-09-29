param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'Certificates'),
    [string]$Password = 'MasterThesisOsWidgetPoc'
)

$ErrorActionPreference = 'Stop'
$subject = 'CN=Master Thesis OS Development'
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$pfxPath = Join-Path $OutputDirectory 'MasterThesisOs.WidgetPoc.pfx'
$cerPath = Join-Path $OutputDirectory 'MasterThesisOs.WidgetPoc.cer'

$certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $subject `
    -FriendlyName 'Master Thesis OS Widget PoC' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')

$securePassword = ConvertTo-SecureString -String $Password -AsPlainText -Force
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null

Write-Output "Created: $pfxPath"
Write-Output "Created: $cerPath"
Write-Output "Thumbprint: $($certificate.Thumbprint)"
