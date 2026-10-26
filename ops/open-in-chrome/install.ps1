<#
 Registers the per-user URL protocol "chocomint-open:" so the web app, when shown inside an embedded web view
 (wallpaper app), can open a school-portal link in Chrome. No admin rights; only HKCU is written.
 Only https://sp.ritsumei.ac.jp/... is ever opened (see open-in-chrome.vbs).
   install:    powershell -ExecutionPolicy Bypass -File install.ps1
   uninstall:  powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#>
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$key = 'HKCU:\Software\Classes\chocomint-open'
$dir = Join-Path $env:LOCALAPPDATA 'MasterThesisOS\open-in-chrome'
if ($Uninstall) {
    if (Test-Path $key) { Remove-Item $key -Recurse -Force }
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    'chocomint-open: removed'
    return
}
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'open-in-chrome.vbs') (Join-Path $dir 'open-in-chrome.vbs') -Force
New-Item $key -Force | Out-Null
Set-ItemProperty $key '(default)' 'URL:Chocomint open in Chrome'
New-ItemProperty $key 'URL Protocol' -Value '' -Force | Out-Null
New-Item "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty "$key\shell\open\command" '(default)' ('wscript.exe //B "{0}" "%1"' -f (Join-Path $dir 'open-in-chrome.vbs'))
'chocomint-open: registered'
