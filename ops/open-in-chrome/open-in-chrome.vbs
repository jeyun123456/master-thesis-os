' Opens an allow-listed https URL in Chrome. Started by the chocomint-open: URL protocol (per-user, no admin).
Option Explicit
Dim arg, url, chrome, sh, fso
If WScript.Arguments.Count < 1 Then WScript.Quit 1
arg = WScript.Arguments(0)
If LCase(Left(arg, 15)) <> "chocomint-open:" Then WScript.Quit 2
url = Mid(arg, 16)
' only the school portal over https; no quotes, whitespace or control characters
If LCase(Left(url, 26)) <> "https://sp.ritsumei.ac.jp/" Then WScript.Quit 3
If InStr(url, """") > 0 Or InStr(url, " ") > 0 Or InStr(url, vbCr) > 0 Or InStr(url, vbLf) > 0 Or Len(url) > 2000 Then WScript.Quit 4
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
chrome = sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe")
If Not fso.FileExists(chrome) Then chrome = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe")
If Not fso.FileExists(chrome) Then WScript.Quit 5
sh.Run """" & chrome & """ """ & url & """", 1, False
