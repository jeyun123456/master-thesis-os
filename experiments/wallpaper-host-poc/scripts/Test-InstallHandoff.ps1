[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PublishDirectory
)

$ErrorActionPreference = 'Stop'
$installerPath = Join-Path $PSScriptRoot 'Install-WallpaperHost.ps1'
$resolvedPublishDirectory = (Resolve-Path -LiteralPath $PublishDirectory).Path

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Get-TreeDigest {
    param([string]$Path)

    $root = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\') + '\'
    $entries = @(
        Get-ChildItem -LiteralPath $Path -File -Recurse -Force |
            ForEach-Object {
                $relativePath = $_.FullName.Substring($root.Length).Replace('\', '/')
                $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                "$relativePath`t$hash"
            }
    )
    [Array]::Sort([string[]]$entries, [StringComparer]::Ordinal)
    return [string]::Join("`n", $entries)
}

function Copy-PublishFixture {
    param([string]$Destination)

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $resolvedPublishDirectory -Force |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}

function Assert-ValidationFails {
    param([string]$Path, [string]$Name)

    $failed = $false
    try {
        $null = & $installerPath -PublishDirectory $Path -ValidateOnly
    } catch {
        $failed = $true
    }
    Assert-True $failed "$Name should fail before installation."
}

$installerText = Get-Content -LiteralPath $installerPath -Raw -Encoding utf8
$tokens = $null
$parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $installerPath,
    [ref]$tokens,
    [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) 'Installer PowerShell syntax must parse.'

$publishCalls = @($installerAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand -and
        $node.CommandElements.Count -gt 0 -and
        $node.CommandElements[0] -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $node.CommandElements[0].VariablePath.UserPath -ceq 'PublishScript'
}, $true))
Assert-True ($publishCalls.Count -eq 1) 'Default installer must retain exactly one Publish-Release invocation.'
Assert-True ($installerText -match '(?s)if\s*\(-not\s+\$hasPrebuiltPublishDirectory\)\s*\{\s*&\s+\$PublishScript\s+-OutputPath\s+\$PublishDirectory') 'Publish-Release must remain guarded by default mode.'
Assert-True ($installerText -match '(?s)if\s*\(\$ValidateOnly\).*?return\s*\}.*?\$RootDirectory\s*=.*?Get-Process') 'Validation-only mode must return before installed-path and process actions.'
Assert-True ($installerText -match 'Remove-Item\s+-LiteralPath\s+\$GeneratedPublishDirectory') 'Cleanup must target only the generated publish directory.'
Assert-True ($installerText -notmatch 'Remove-Item\s+\$PublishDirectory') 'Installer must not clean up the supplied publish directory.'

$sourceDigestBefore = Get-TreeDigest -Path $resolvedPublishDirectory
$defaultOutput = @(& $installerPath -ValidateOnly) -join "`n"
Assert-True ($defaultOutput -match 'Publish-Release\.ps1; validation-only mode did not build or install') 'Default validation-only mode must preserve the build path without running it.'
$candidateOutput = @(& $installerPath -PublishDirectory $resolvedPublishDirectory -ValidateOnly) -join "`n"
$candidateProvenance = Get-Content -LiteralPath (Join-Path $resolvedPublishDirectory 'bridge-runtime\bridge-provenance.json') -Raw -Encoding utf8 | ConvertFrom-Json
Assert-True ($candidateProvenance.sourceCommit -ceq '7a1c6c4009a4b6a3c61a7ef206bda5072344f975') 'R1 provenance source SHA must remain unchanged.'
Assert-True ($candidateProvenance.bridgeApiVersion -eq 7) 'R1 Bridge API version must remain v7.'
Assert-True ($candidateProvenance.sourceTreeClean -eq $false) 'R1 checkout cleanliness flag must remain unchanged.'
Assert-True ($candidateOutput -match [regex]::Escape($candidateProvenance.sourceCommit)) 'Prebuilt mode must report the artifact source SHA unchanged.'

$tempRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('mthos-install-handoff-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $missingExe = Join-Path $tempRoot 'missing-exe'
    Copy-PublishFixture -Destination $missingExe
    Remove-Item -LiteralPath (Join-Path $missingExe 'MasterThesisOSWallpaper.exe')
    Assert-ValidationFails -Path $missingExe -Name 'Missing executable'

    $missingRuntime = Join-Path $tempRoot 'missing-runtime'
    Copy-PublishFixture -Destination $missingRuntime
    Remove-Item -LiteralPath (Join-Path $missingRuntime 'bridge-runtime') -Recurse -Force
    Assert-ValidationFails -Path $missingRuntime -Name 'Missing Bridge runtime'

    $missingModule = Join-Path $tempRoot 'missing-module'
    Copy-PublishFixture -Destination $missingModule
    Remove-Item -LiteralPath (Join-Path $missingModule 'bridge-runtime\mail_jobs.py')
    Assert-ValidationFails -Path $missingModule -Name 'Missing required Bridge file'

    $missingProvenance = Join-Path $tempRoot 'missing-provenance'
    Copy-PublishFixture -Destination $missingProvenance
    Remove-Item -LiteralPath (Join-Path $missingProvenance 'bridge-runtime\bridge-provenance.json')
    Assert-ValidationFails -Path $missingProvenance -Name 'Missing provenance'

    $invalidProvenance = Join-Path $tempRoot 'invalid-provenance'
    Copy-PublishFixture -Destination $invalidProvenance
    Set-Content -LiteralPath (Join-Path $invalidProvenance 'bridge-runtime\bridge-provenance.json') -Value '{' -Encoding utf8
    Assert-ValidationFails -Path $invalidProvenance -Name 'Invalid provenance JSON'

    $badHash = Join-Path $tempRoot 'bad-hash'
    Copy-PublishFixture -Destination $badHash
    Add-Content -LiteralPath (Join-Path $badHash 'bridge-runtime\bridge.py') -Value '# modified after validation'
    Assert-ValidationFails -Path $badHash -Name 'Changed Bridge file hash'

    $unsafePath = Join-Path $tempRoot 'unsafe-path'
    Copy-PublishFixture -Destination $unsafePath
    $unsafeProvenancePath = Join-Path $unsafePath 'bridge-runtime\bridge-provenance.json'
    $unsafeProvenance = Get-Content -LiteralPath $unsafeProvenancePath -Raw -Encoding utf8 | ConvertFrom-Json
    $unsafeProvenance.files[0].path = '..\bridge.py'
    $unsafeProvenance | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $unsafeProvenancePath -Encoding utf8
    Assert-ValidationFails -Path $unsafePath -Name 'Unsafe provenance path'

    $missingManifestEntry = Join-Path $tempRoot 'missing-manifest-entry'
    Copy-PublishFixture -Destination $missingManifestEntry
    $manifestPath = Join-Path $missingManifestEntry 'bridge-runtime\bridge-provenance.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    $manifest.files = @($manifest.files | Where-Object { $_.path -cne 'portal_jobs.py' })
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Assert-ValidationFails -Path $missingManifestEntry -Name 'Incomplete provenance file list'

    $apiMismatch = Join-Path $tempRoot 'api-mismatch'
    Copy-PublishFixture -Destination $apiMismatch
    $manifestPath = Join-Path $apiMismatch 'bridge-runtime\bridge-provenance.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    $manifest.bridgeApiVersion = 6
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Assert-ValidationFails -Path $apiMismatch -Name 'Bridge API mismatch'
} finally {
    $resolvedTempRoot = (Resolve-Path -LiteralPath $tempRoot).Path.TrimEnd('\')
    $resolvedTempBase = (Resolve-Path -LiteralPath ([IO.Path]::GetFullPath($env:TEMP))).Path.TrimEnd('\')
    $requiredPrefix = $resolvedTempBase + '\mthos-install-handoff-test-'
    Assert-True ($resolvedTempRoot.StartsWith($requiredPrefix, [StringComparison]::OrdinalIgnoreCase)) 'Refusing to remove a test directory outside its dedicated temp root.'
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
}

$sourceDigestAfter = Get-TreeDigest -Path $resolvedPublishDirectory
Assert-True ([string]::Equals($sourceDigestBefore, $sourceDigestAfter, [StringComparison]::Ordinal)) 'Installer validation changed the supplied publish artifact.'
Write-Output 'Install handoff tests passed: syntax, default dispatch, valid artifact, fail-closed fixtures, source SHA, and artifact immutability.'
