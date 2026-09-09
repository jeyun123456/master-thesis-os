[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ConfigErrorExitCode = 78
$DefaultPort = 38471
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bridgeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRunner = Join-Path $bridgeDirectory 'start_bridge.ps1'
$configPath = Join-Path $bridgeDirectory 'config.json'
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

function Get-BridgePort {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw 'Missing config.json. Copy config.example.json to config.json and edit it.'
    }
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } catch {
        throw "Invalid config.json: $($_.Exception.Message)"
    }
    $rawPort = $config.port
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
$openHealth = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 상태 확인')
$exitBridge = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 종료')
[void]$menu.Items.Add($copyToken)
[void]$menu.Items.Add($openHealth)
[void]$menu.Items.Add($exitBridge)
$notifyIcon.ContextMenuStrip = $menu

$copyToken.Add_Click({
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $token = [string]$config.token
        if ([string]::IsNullOrWhiteSpace($token)) {
            throw 'token is empty'
        }
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

$openHealth.Add_Click({
    try {
        $port = Get-BridgePort
        Start-Process ("http://127.0.0.1:{0}/health" -f $port)
    } catch {
        Show-BridgeNotice $_.Exception.Message
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
