$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $Root 'gradle\wrapper\gradle-wrapper.jar'
$Temp = "$Dest.tmp"
$Url = 'https://services.gradle.org/distributions/gradle-8.13-wrapper.jar'
$Expected = '81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Temp
$Actual = (Get-FileHash -Path $Temp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) {
    Remove-Item -Force $Temp -ErrorAction SilentlyContinue
    throw "Gradle wrapper JAR checksum mismatch. Expected $Expected, got $Actual"
}
Move-Item -Force $Temp $Dest
Write-Host 'Installed verified Gradle 8.13 wrapper JAR.'
