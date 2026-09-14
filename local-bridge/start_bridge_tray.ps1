[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ConfigErrorExitCode = 78
$DefaultPort = 38471
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bridgeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRunner = Join-Path $bridgeDirectory 'start_bridge.ps1'
$overrideConfigPath = $env:MTO_BRIDGE_CONFIG
if (-not [string]::IsNullOrWhiteSpace($overrideConfigPath)) {
    $configPath = [Environment]::ExpandEnvironmentVariables($overrideConfigPath.Trim())
} elseif (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $sharedConfigPath = Join-Path $env:LOCALAPPDATA 'MasterThesisOSWallpaper\bridge\config.json'
    $configPath = if (Test-Path -LiteralPath $sharedConfigPath) {
        $sharedConfigPath
    } else {
        Join-Path $bridgeDirectory 'config.json'
    }
} else {
    $configPath = Join-Path $bridgeDirectory 'config.json'
}
if (-not (Test-Path -LiteralPath $bridgeRunner -PathType Leaf)) {
    throw "Missing start_bridge.ps1 in $bridgeDirectory."
}

function Start-BridgeRunner {
    return Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', "`"$bridgeRunner`""
    ) -WindowStyle Hidden -PassThru
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $ProcessId }
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Read-BridgeConfig {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw 'Missing config.json. Copy config.example.json to config.json and edit it.'
    }

    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($null -eq $config -or $config -is [System.Array] -or $config -isnot [pscustomobject]) {
            throw 'config.json must contain an object.'
        }

        return $config
    } catch {
        throw 'Invalid config.json. Fix the JSON and restart the bridge.'
    }
}

function Get-ExactConfigProperty {
    param(
        [object]$Config,
        [string]$Name
    )

    $property = $Config.PSObject.Properties |
        Where-Object { $_.Name -ceq $Name } |
        Select-Object -First 1
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-BridgeToken {
    $config = Read-BridgeConfig
    $tokenValue = Get-ExactConfigProperty -Config $config -Name 'token'
    if ($tokenValue -isnot [string]) {
        throw 'Bridge token is invalid.'
    }

    $token = [string]$tokenValue
    if ([string]::IsNullOrWhiteSpace($token) -or
        $token.Length -lt 32 -or
        $token.StartsWith('CHANGE-THIS', [System.StringComparison]::Ordinal)) {
        throw 'Bridge token is invalid.'
    }

    return $token
}

function Get-BridgePort {
    $config = Read-BridgeConfig
    $rawPort = Get-ExactConfigProperty -Config $config -Name 'port'
    if ($null -eq $rawPort) {
        return $DefaultPort
    }
    if ($rawPort -is [bool] -or $rawPort -is [double] -or $rawPort -is [decimal]) {
        throw 'config.json port must be an integer between 1024 and 65535.'
    }
    try {
        $port = [int]$rawPort
    } catch {
        throw 'config.json port must be an integer between 1024 and 65535.'
    }
    if ($port -lt 1024 -or $port -gt 65535) {
        throw 'config.json port must be an integer between 1024 and 65535.'
    }
    return $port
}

function Show-BridgeNotice {
    param([string]$Message)
    $notifyIcon.BalloonTipTitle = 'Master Thesis OS Bridge'
    $notifyIcon.BalloonTipText = $Message
    $notifyIcon.ShowBalloonTip(2200)
}

$state = @{ runner = Start-BridgeRunner; stopping = $false; permanentError = $false }
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = 'Master Thesis OS Bridge'
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$copyToken = New-Object System.Windows.Forms.ToolStripMenuItem('Bridge token 복사')
$viewToken = New-Object System.Windows.Forms.ToolStripMenuItem('Bridge token 보기')
$openHealth = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 상태 확인')
$exitBridge = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 종료')
[void]$menu.Items.Add($copyToken)
[void]$menu.Items.Add($viewToken)
[void]$menu.Items.Add($openHealth)
[void]$menu.Items.Add($exitBridge)
$notifyIcon.ContextMenuStrip = $menu

$copyToken.Add_Click({
    try {
        $token = Get-BridgeToken
        Set-Clipboard -Value $token
        $notifyIcon.BalloonTipTitle = 'Master Thesis OS Bridge'
        $notifyIcon.BalloonTipText = 'Bridge token을 클립보드에 복사했어.'
        $notifyIcon.ShowBalloonTip(1800)
    } catch {
        $notifyIcon.BalloonTipTitle = 'Master Thesis OS Bridge'
        $notifyIcon.BalloonTipText = 'Bridge token을 복사하지 못했어.'
        $notifyIcon.ShowBalloonTip(2200)
    }
})

$viewToken.Add_Click({
    try {
        $token = Get-BridgeToken

        $dialog = New-Object System.Windows.Forms.Form
        $dialog.Text = 'Master Thesis OS Bridge token'
        $dialog.StartPosition = 'CenterScreen'
        $dialog.ClientSize = New-Object System.Drawing.Size(560, 132)
        $dialog.FormBorderStyle = 'FixedDialog'
        $dialog.MaximizeBox = $false
        $dialog.MinimizeBox = $false
        $dialog.ShowInTaskbar = $false
        $dialog.TopMost = $true

        $tokenBox = New-Object System.Windows.Forms.TextBox
        $tokenBox.Location = New-Object System.Drawing.Point(12, 14)
        $tokenBox.Size = New-Object System.Drawing.Size(536, 23)
        $tokenBox.ReadOnly = $true
        $tokenBox.UseSystemPasswordChar = $true
        $tokenBox.Text = $token

        $showValue = New-Object System.Windows.Forms.CheckBox
        $showValue.Text = '토큰 표시'
        $showValue.AutoSize = $true
        $showValue.Location = New-Object System.Drawing.Point(12, 48)
        $showValue.Add_CheckedChanged({ $tokenBox.UseSystemPasswordChar = -not $showValue.Checked })

        $copy = New-Object System.Windows.Forms.Button
        $copy.Text = '복사'
        $copy.Size = New-Object System.Drawing.Size(78, 27)
        $copy.Location = New-Object System.Drawing.Point(370, 88)
        $copy.Add_Click({
            Set-Clipboard -Value $token
            $dialog.Close()
            Show-BridgeNotice 'Bridge token을 클립보드에 복사했어.'
        })

        $close = New-Object System.Windows.Forms.Button
        $close.Text = '닫기'
        $close.Size = New-Object System.Drawing.Size(78, 27)
        $close.Location = New-Object System.Drawing.Point(458, 88)
        $close.Add_Click({ $dialog.Close() })

        [void]$dialog.Controls.Add($tokenBox)
        [void]$dialog.Controls.Add($showValue)
        [void]$dialog.Controls.Add($copy)
        [void]$dialog.Controls.Add($close)
        $dialog.Add_Shown({ $dialog.Activate(); $close.Focus() })
        [void]$dialog.ShowDialog()
        $dialog.Dispose()
    } catch {
        Show-BridgeNotice 'Bridge token을 표시하지 못했어.'
    }
})

$openHealth.Add_Click({
    try {
        $port = Get-BridgePort
        Start-Process ("http://127.0.0.1:{0}/health" -f $port)
    } catch {
        Show-BridgeNotice '브리지 상태를 확인하지 못했어. config.json을 확인하고 트레이 실행기를 다시 시작해줘.'
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    if (-not $state.stopping -and -not $state.permanentError -and $state.runner.HasExited) {
        if ($state.runner.ExitCode -eq $ConfigErrorExitCode) {
            $state.permanentError = $true
            Show-BridgeNotice '설정 오류로 브리지가 시작되지 않았어. config.json을 수정하고 트레이 실행기를 다시 시작해줘.'
            return
        }
        $state.runner = Start-BridgeRunner
    }
})
$timer.Start()

$exitBridge.Add_Click({
    $state.stopping = $true
    $timer.Stop()
    if ($null -ne $state.runner -and -not $state.runner.HasExited) {
        Stop-ProcessTree -ProcessId $state.runner.Id
    }
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $menu.Dispose()
    [System.Windows.Forms.Application]::ExitThread()
})

[System.Windows.Forms.Application]::Run()
