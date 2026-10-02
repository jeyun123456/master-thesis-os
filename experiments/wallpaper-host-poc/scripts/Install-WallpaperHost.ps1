[CmdletBinding()]
param(
    [string]$PublishDirectory,
    [switch]$NoLaunch,
    [switch]$DesktopShortcut,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

$RepositoryDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

function Test-SameOrdinalValues {
    param(
        [Parameter(Mandatory=$true)][string[]]$Left,
        [Parameter(Mandatory=$true)][string[]]$Right
    )

    $leftSorted = [string[]]$Left.Clone()
    $rightSorted = [string[]]$Right.Clone()
    [Array]::Sort($leftSorted, [StringComparer]::Ordinal)
    [Array]::Sort($rightSorted, [StringComparer]::Ordinal)
    return [string]::Equals(
        [string]::Join("`n", $leftSorted),
        [string]::Join("`n", $rightSorted),
        [StringComparison]::Ordinal
    )
}

function Assert-ValidatedPublishDirectory {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$RepositoryDirectory
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Publish directory was not found: $Path"
    }

    $resolvedDirectory = (Resolve-Path -LiteralPath $Path).Path
    $requiredHostFiles = @(
        'MasterThesisOSWallpaper.exe',
        'MasterThesisOSWallpaper.dll',
        'MasterThesisOSWallpaper.deps.json',
        'MasterThesisOSWallpaper.runtimeconfig.json',
        'Microsoft.Web.WebView2.Core.dll',
        'Microsoft.Web.WebView2.WinForms.dll',
        'Microsoft.Web.WebView2.Wpf.dll',
        'WebView2Loader.dll',
        'runtimes\win-x64\native\WebView2Loader.dll'
    )
    foreach ($relativePath in $requiredHostFiles) {
        $requiredPath = Join-Path $resolvedDirectory $relativePath
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf) -or
            (Get-Item -LiteralPath $requiredPath).Length -le 0) {
            throw "Publish directory is missing a required host file: $relativePath"
        }
    }

    foreach ($jsonName in @('MasterThesisOSWallpaper.deps.json', 'MasterThesisOSWallpaper.runtimeconfig.json')) {
        try {
            [void](Get-Content -LiteralPath (Join-Path $resolvedDirectory $jsonName) -Raw -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop)
        } catch {
            throw "Publish directory contains invalid JSON in $jsonName."
        }
    }

    $runtimeDirectory = Join-Path $resolvedDirectory 'bridge-runtime'
    if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container)) {
        throw 'Publish directory is missing bridge-runtime.'
    }

    $provenancePath = Join-Path $runtimeDirectory 'bridge-provenance.json'
    if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
        throw 'Publish directory is missing bridge-runtime\bridge-provenance.json.'
    }

    try {
        $provenance = Get-Content -LiteralPath $provenancePath -Raw -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw 'Bridge provenance is not valid JSON.'
    }

    $expectedProvenanceFields = @('formatVersion', 'sourceCommit', 'sourceTreeClean', 'bridgeApiVersion', 'files')
    $actualProvenanceFields = @($provenance.PSObject.Properties.Name)
    if (-not (Test-SameOrdinalValues -Left $expectedProvenanceFields -Right $actualProvenanceFields)) {
        throw 'Bridge provenance has an unexpected field set.'
    }
    if ($provenance.formatVersion -is [bool] -or
        ($provenance.formatVersion -isnot [int] -and $provenance.formatVersion -isnot [long]) -or
        $provenance.formatVersion -ne 1) {
        throw 'Bridge provenance formatVersion must be 1.'
    }
    if ($provenance.sourceCommit -isnot [string] -or
        $provenance.sourceCommit -cnotmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$') {
        throw 'Bridge provenance sourceCommit must be a full lowercase Git SHA.'
    }
    if ($provenance.sourceTreeClean -isnot [bool]) {
        throw 'Bridge provenance sourceTreeClean must be a Boolean.'
    }
    if ($provenance.bridgeApiVersion -is [bool] -or
        ($provenance.bridgeApiVersion -isnot [int] -and $provenance.bridgeApiVersion -isnot [long])) {
        throw 'Bridge provenance bridgeApiVersion must be an integer.'
    }
    if ($provenance.files -isnot [System.Array] -or $provenance.files.Count -eq 0) {
        throw 'Bridge provenance files must be a non-empty array.'
    }

    $manifestNames = @()
    $seenNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $provenance.files) {
        $fileFields = @($file.PSObject.Properties.Name)
        if (-not (Test-SameOrdinalValues -Left @('path', 'sha256') -Right $fileFields)) {
            throw 'Bridge provenance file entries must contain only path and sha256.'
        }
        if ($file.path -isnot [string] -or $file.path -cnotmatch '^[A-Za-z0-9_.-]+$' -or
            $file.path -ceq '.' -or $file.path -ceq '..') {
            throw 'Bridge provenance contains an unsafe runtime file path.'
        }
        if (-not $seenNames.Add($file.path)) {
            throw "Bridge provenance contains a duplicate runtime file: $($file.path)"
        }
        if ($file.sha256 -isnot [string] -or $file.sha256 -cnotmatch '^[0-9a-f]{64}$') {
            throw "Bridge provenance contains an invalid SHA-256 for $($file.path)."
        }
        $manifestNames += $file.path
    }

    $sortedManifestNames = [string[]]$manifestNames.Clone()
    [Array]::Sort($sortedManifestNames, [StringComparer]::Ordinal)
    if (-not [string]::Equals(
        [string]::Join("`n", $manifestNames),
        [string]::Join("`n", $sortedManifestNames),
        [StringComparison]::Ordinal
    )) {
        throw 'Bridge provenance file list is not deterministically sorted.'
    }

    $publishScriptPath = Join-Path $RepositoryDirectory 'experiments\wallpaper-host-poc\scripts\Publish-Release.ps1'
    $publishScriptText = Get-Content -LiteralPath $publishScriptPath -Raw -Encoding utf8
    $publishListMatch = [regex]::Match(
        $publishScriptText,
        '\$BridgeRuntimeFiles\s*=\s*@\((.*?)\)',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if (-not $publishListMatch.Success) {
        throw 'Could not read the Bridge runtime publish allowlist.'
    }
    $publishNames = @(
        [regex]::Matches($publishListMatch.Groups[1].Value, "(?m)^\s*'([^']+)'\s*,?\s*$") |
            ForEach-Object { $_.Groups[1].Value }
    )

    $processManagerPath = Join-Path $RepositoryDirectory 'experiments\wallpaper-host-poc\BridgeProcessManager.cs'
    $processManagerText = Get-Content -LiteralPath $processManagerPath -Raw -Encoding utf8
    $requiredListMatch = [regex]::Match(
        $processManagerText,
        'RequiredBridgeFiles\s*=\s*\[(.*?)\]\s*;',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if (-not $requiredListMatch.Success) {
        throw 'Could not read BridgeProcessManager.RequiredBridgeFiles.'
    }
    $requiredNames = @(
        [regex]::Matches($requiredListMatch.Groups[1].Value, '"([^"\r\n]+)"') |
            ForEach-Object { $_.Groups[1].Value }
    )
    $publishRuntimeNames = @($publishNames | Where-Object { $_ -cne 'start_bridge.ps1' })
    if ($publishNames.Count -eq 0 -or
        -not (Test-SameOrdinalValues -Left $manifestNames -Right $publishNames) -or
        -not (Test-SameOrdinalValues -Left $requiredNames -Right $publishRuntimeNames) -or
        $publishNames -cnotcontains 'start_bridge.ps1') {
        throw 'Bridge provenance does not match the current publish and required-runtime file lists.'
    }

    $runtimeEntries = @(Get-ChildItem -LiteralPath $runtimeDirectory -Force)
    if (@($runtimeEntries | Where-Object { $_.PSIsContainer }).Count -gt 0) {
        throw 'bridge-runtime must contain only the published runtime files.'
    }
    $actualRuntimeNames = @($runtimeEntries | ForEach-Object { $_.Name } | Where-Object { $_ -cne 'bridge-provenance.json' })
    if (-not (Test-SameOrdinalValues -Left $manifestNames -Right $actualRuntimeNames)) {
        throw 'bridge-runtime contents do not match the provenance file list.'
    }

    foreach ($file in $provenance.files) {
        $packagedFile = Join-Path $runtimeDirectory $file.path
        if (-not (Test-Path -LiteralPath $packagedFile -PathType Leaf)) {
            throw "A required Bridge runtime file is missing: $($file.path)"
        }
        $actualHash = (Get-FileHash -LiteralPath $packagedFile -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -cne $file.sha256) {
            throw "Bridge runtime hash does not match provenance: $($file.path)"
        }
    }

    $bridgeSource = Get-Content -LiteralPath (Join-Path $runtimeDirectory 'bridge.py') -Raw -Encoding utf8
    $apiVersionMatches = [regex]::Matches($bridgeSource, '(?m)^\s*BRIDGE_API_VERSION\s*=\s*(\d+)\s*(?:#.*)?$')
    if ($apiVersionMatches.Count -ne 1 -or
        [int]$apiVersionMatches[0].Groups[1].Value -ne $provenance.bridgeApiVersion) {
        throw 'Bridge provenance API version does not match the packaged bridge.py contract.'
    }

    return $resolvedDirectory
}

$hasPrebuiltPublishDirectory = -not [string]::IsNullOrWhiteSpace($PublishDirectory)
if ($hasPrebuiltPublishDirectory) {
    $PublishDirectory = Assert-ValidatedPublishDirectory -Path $PublishDirectory -RepositoryDirectory $RepositoryDirectory
}

if ($ValidateOnly) {
    if ($hasPrebuiltPublishDirectory) {
        $validatedProvenance = Get-Content -LiteralPath (Join-Path $PublishDirectory 'bridge-runtime\bridge-provenance.json') -Raw -Encoding utf8 | ConvertFrom-Json
        Write-Output "Validated publish directory: $PublishDirectory"
        Write-Output "Bridge API: v$($validatedProvenance.bridgeApiVersion)"
        Write-Output "Source commit: $($validatedProvenance.sourceCommit)"
    } else {
        Write-Output 'Default mode would run Publish-Release.ps1; validation-only mode did not build or install.'
    }
    return
}

$RootDirectory = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper'
$AppDirectory = Join-Path $RootDirectory 'app'
$InstalledExe = Join-Path $AppDirectory 'MasterThesisOSWallpaper.exe'
$InstalledBridgeRuntimeDirectory = Join-Path $AppDirectory 'bridge-runtime'
$InstalledUninstaller = Join-Path $RootDirectory 'Uninstall-MasterThesisOSWallpaper.ps1'
$BridgeDirectory = Join-Path $RootDirectory 'bridge'
$BridgeConfigPath = Join-Path $BridgeDirectory 'config.json'
$SourceBridgeConfig = Join-Path $RepositoryDirectory 'local-bridge\config.json'
$RunKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'MasterThesisOSWallpaperHost'
$PublishScript = Join-Path $PSScriptRoot 'Publish-Release.ps1'
$UninstallScript = Join-Path $PSScriptRoot 'Uninstall-WallpaperHost.ps1'
$GeneratedPublishDirectory = $null
if (-not $hasPrebuiltPublishDirectory) {
    $GeneratedPublishDirectory = Join-Path $env:TEMP ('MasterThesisOSWallpaper-publish-' + [guid]::NewGuid().ToString('N'))
    $PublishDirectory = $GeneratedPublishDirectory
}

$ProgramsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
if ([string]::IsNullOrWhiteSpace($ProgramsDirectory)) {
    $ProgramsDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
}
$StartMenuDirectory = Join-Path $ProgramsDirectory 'Master Thesis OS'
$AppShortcut = Join-Path $StartMenuDirectory 'Master Thesis OS Wallpaper.lnk'
$UninstallShortcut = Join-Path $StartMenuDirectory 'Uninstall Master Thesis OS Wallpaper.lnk'
$desktopDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktopDir)) {
    $desktopDir = Join-Path $env:USERPROFILE 'Desktop'
}
$DesktopShortcutPath = Join-Path $desktopDir 'Master Thesis OS Wallpaper.lnk'

function New-Shortcut {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = '',
        [string]$Description = ''
    )

    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($Path)
        $shortcut.TargetPath = $TargetPath
        $shortcut.Arguments = $Arguments
        $shortcut.WorkingDirectory = $WorkingDirectory
        $shortcut.IconLocation = $IconLocation
        $shortcut.Description = $Description
        $shortcut.Save()
    } finally {
        if ($null -ne $shell) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
        }
    }
}

function Stop-InstalledBridgeRuntime {
    param(
        [Parameter(Mandatory=$true)][string]$RuntimeDirectory
    )

    $runtimePattern = [regex]::Escape([IO.Path]::GetFullPath($RuntimeDirectory))
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $bridgeProcesses = @()
        try {
            $bridgeProcesses = @(
                Get-CimInstance Win32_Process -ErrorAction Stop |
                    Where-Object {
                        $_.ProcessId -ne $PID -and
                        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
                        $_.CommandLine -match $runtimePattern
                    }
            )
        } catch {
            break
        }

        if ($bridgeProcesses.Count -eq 0) {
            return
        }

        foreach ($bridgeProcess in $bridgeProcesses) {
            Stop-Process -Id $bridgeProcess.ProcessId -Force -ErrorAction SilentlyContinue
        }

        Start-Sleep -Milliseconds 250
    }
}

$currentStartup = $null
try {
    $currentStartup = (Get-ItemProperty -Path $RunKeyPath -Name $RunValueName -ErrorAction Stop).$RunValueName
} catch {
    $currentStartup = $null
}

$startupWasEnabled = -not [string]::IsNullOrWhiteSpace($currentStartup)
$desktopShortcutAlreadyExists = Test-Path $DesktopShortcutPath

try {
    Write-Host 'Stopping existing wallpaper host...'
    $existingHosts = @(
        Get-Process -Name WallpaperHostPoc,MasterThesisOSWallpaper -ErrorAction SilentlyContinue
    )

    foreach ($hostProcess in $existingHosts) {
        try {
            [void]$hostProcess.CloseMainWindow()
        } catch {
            # The process may exit between enumeration and the close request.
        }
    }

    foreach ($hostProcess in $existingHosts) {
        try {
            [void]$hostProcess.WaitForExit(4000)
        } catch {
            # The process may already have exited.
        }
    }

    $remainingHosts = @(
        Get-Process -Name WallpaperHostPoc,MasterThesisOSWallpaper -ErrorAction SilentlyContinue
    )
    if ($remainingHosts.Count -gt 0) {
        $remainingHosts | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500

    Stop-InstalledBridgeRuntime -RuntimeDirectory $InstalledBridgeRuntimeDirectory

    if (-not $hasPrebuiltPublishDirectory) {
        & $PublishScript -OutputPath $PublishDirectory
    }

    New-Item -ItemType Directory -Path $RootDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $BridgeDirectory -Force | Out-Null

    if (-not (Test-Path -LiteralPath $BridgeConfigPath -PathType Leaf) -and
        (Test-Path -LiteralPath $SourceBridgeConfig -PathType Leaf)) {
        Copy-Item -LiteralPath $SourceBridgeConfig -Destination $BridgeConfigPath -Force
        Write-Host 'Migrated the existing Local Bridge config to the shared data directory.'
    }

    # Replace the release contents in place. Keeping the app directory itself
    # avoids a Windows directory-handle race when a child bridge process has
    # just exited. The release copy remains authoritative for every packaged
    # file, while settings/logs stay outside this replaceable directory.
    New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null
    Copy-Item -Path (Join-Path $PublishDirectory '*') -Destination $AppDirectory -Recurse -Force
    Copy-Item -Path $UninstallScript -Destination $InstalledUninstaller -Force

    if (-not (Test-Path $InstalledExe)) {
        throw "Installed executable was not found after copy: $InstalledExe"
    }

    if ($startupWasEnabled) {
        $startupCommand = '"' + $InstalledExe + '" --wallpaper'
        New-Item -Path $RunKeyPath -Force | Out-Null
        Set-ItemProperty -Path $RunKeyPath -Name $RunValueName -Value $startupCommand
        Write-Host 'Updated existing Start with Windows entry to the installed executable.'
    }

    New-Item -ItemType Directory -Path $StartMenuDirectory -Force | Out-Null

    New-Shortcut `
        -Path $AppShortcut `
        -TargetPath $InstalledExe `
        -Arguments '--wallpaper' `
        -WorkingDirectory $AppDirectory `
        -IconLocation ($InstalledExe + ',0') `
        -Description 'Open Master Thesis OS Wallpaper Companion'

    $powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    New-Shortcut `
        -Path $UninstallShortcut `
        -TargetPath $powershellExe `
        -Arguments ('-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledUninstaller + '"') `
        -WorkingDirectory $RootDirectory `
        -IconLocation ($InstalledExe + ',0') `
        -Description 'Uninstall Master Thesis OS Wallpaper Companion'

    if ($DesktopShortcut -or $desktopShortcutAlreadyExists) {
        New-Shortcut `
            -Path $DesktopShortcutPath `
            -TargetPath $InstalledExe `
            -Arguments '--wallpaper' `
            -WorkingDirectory $AppDirectory `
            -IconLocation ($InstalledExe + ',0') `
            -Description 'Open Master Thesis OS Wallpaper Companion'
    }

    Write-Host ''
    Write-Host 'Installed Master Thesis OS Wallpaper Companion:'
    Write-Host "  $InstalledExe"
    Write-Host ''
    Write-Host 'Start Menu shortcuts:'
    Write-Host "  $StartMenuDirectory"
    Write-Host ''
    Write-Host 'Settings and logs were preserved under:'
    Write-Host "  $RootDirectory"

    if ($DesktopShortcut -or $desktopShortcutAlreadyExists) {
        Write-Host ''
        Write-Host 'Desktop shortcut:'
        Write-Host "  $DesktopShortcutPath"
    }

    if (-not $NoLaunch) {
        Start-Process -FilePath $InstalledExe -ArgumentList '--wallpaper'
        Write-Host 'Wallpaper companion launched.'
    }
} finally {
    if ($null -ne $GeneratedPublishDirectory -and (Test-Path -LiteralPath $GeneratedPublishDirectory)) {
        Remove-Item -LiteralPath $GeneratedPublishDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
