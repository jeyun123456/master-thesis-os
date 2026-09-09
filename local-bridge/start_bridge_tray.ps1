[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bridgeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRunner = Join-Path $bridgeDirectory 'start_bridge.ps1'
$configPath = Join-Path $bridgeDirectory 'config.json'
if (-not (Test-Path -LiteralPath $bridgeRunner -PathType Leaf)) {
    throw "Missing start_bridge.ps1 in $bridgeDirectory."
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Missing config.json. Copy config.example.json to config.json and edit it."
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

$state = @{ runner = Start-BridgeRunner; stopping = $false }
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
    Start-Process 'http://127.0.0.1:38471/health'
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    if (-not $state.stopping -and $state.runner.HasExited) {
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
