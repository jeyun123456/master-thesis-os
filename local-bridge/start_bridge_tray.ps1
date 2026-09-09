[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bridgeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeRunner = Join-Path $bridgeDirectory 'start_bridge.ps1'
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

$state = @{ runner = Start-BridgeRunner; stopping = $false }
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = 'Master Thesis OS Bridge'
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openHealth = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 상태 확인')
$exitBridge = New-Object System.Windows.Forms.ToolStripMenuItem('브리지 종료')
[void]$menu.Items.Add($openHealth)
[void]$menu.Items.Add($exitBridge)
$notifyIcon.ContextMenuStrip = $menu

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
