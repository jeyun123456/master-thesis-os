[CmdletBinding()]
param([ValidateSet('fast', 'inventory', 'slow')][string]$Tier = 'fast')

# Read-only Windows probe for the server-ops collector. Prints one compact JSON
# document and exits; nothing is started, stopped or changed. Command lines are
# returned raw to the parent Node process, which redacts them before storage.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = [ordered]@{ tier = $Tier; at = [DateTime]::UtcNow.ToString('o') }

function Short($s, $n) { if ($null -eq $s) { return $null }; $s = [string]$s; if ($s.Length -gt $n) { return $s.Substring(0, $n) } else { return $s } }

if ($Tier -eq 'fast') {
    $os = Get-CimInstance Win32_OperatingSystem
    $mem = Get-CimInstance Win32_PerfRawData_PerfOS_Memory
    $pf = Get-CimInstance Win32_PageFileUsage
    $out.mem = [ordered]@{
        total = [int64]$os.TotalVisibleMemorySize * 1KB
        available = [int64]$mem.AvailableBytes
        committed = [int64]$mem.CommittedBytes
        commitLimit = [int64]$mem.CommitLimit
        standby = [int64]$mem.StandbyCacheCoreBytes + [int64]$mem.StandbyCacheNormalPriorityBytes + [int64]$mem.StandbyCacheReserveBytes
        modified = [int64]$mem.ModifiedPageListBytes
        pagefileUsedMB = [int](($pf | Measure-Object CurrentUsage -Sum).Sum)
        pagefileSizeMB = [int](($pf | Measure-Object AllocatedBaseSize -Sum).Sum)
    }
    $out.bootAt = $os.LastBootUpTime.ToUniversalTime().ToString('o')
    # fixed local NTFS volumes only: removable drives come and go, and the Google Drive mount (FAT32 "G:") mirrors cloud quota, not a disk
    $out.disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3 AND FileSystem='NTFS'" | ForEach-Object { [ordered]@{ id = $_.DeviceID; size = [int64]$_.Size; free = [int64]$_.FreeSpace } })
    $out.procs = @(Get-Process | ForEach-Object {
        $cpu = $null; try { $cpu = [math]::Round($_.TotalProcessorTime.TotalSeconds, 2) } catch {}
        [ordered]@{ i = $_.Id; n = $_.ProcessName; w = [int64]$_.WorkingSet64; p = [int64]$_.PrivateMemorySize64; c = $cpu; t = $_.Threads.Count }
    })
}

if ($Tier -eq 'inventory') {
    $out.procs = @(Get-CimInstance Win32_Process | ForEach-Object {
        [ordered]@{ i = [int]$_.ProcessId; pp = [int]$_.ParentProcessId; n = $_.Name; path = Short $_.ExecutablePath 260; cmd = Short $_.CommandLine 1200; st = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } }
    })
    $out.ports = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -in '127.0.0.1', '0.0.0.0', '::', '::1' } | Select-Object -First 300 | ForEach-Object { [ordered]@{ port = $_.LocalPort; pid = $_.OwningProcess; addr = $_.LocalAddress } })
    $out.services = @(Get-CimInstance Win32_Service | Where-Object { ($_.State -eq 'Running' -or $_.StartMode -eq 'Auto') -and $_.PathName -notmatch '\\(System32|SysWOW64)\\|WinSxS|\\Windows Defender\\|WindowsApps' } | ForEach-Object {
        [ordered]@{ name = $_.Name; display = $_.DisplayName; state = $_.State; start = $_.StartMode; pid = [int]$_.ProcessId; path = Short $_.PathName 200 }
    })
}

if ($Tier -eq 'slow') {
    $out.tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notmatch '^\\Microsoft' } | ForEach-Object {
        $i = $_ | Get-ScheduledTaskInfo
        $a = ($_.Actions | Select-Object -First 1)
        $trig = @($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task|Trigger$', '' }) -join ','
        [ordered]@{ path = $_.TaskPath; name = $_.TaskName; state = [string]$_.State; lastRun = if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToUniversalTime().ToString('o') } else { $null }; lastResult = $i.LastTaskResult; nextRun = if ($i.NextRunTime -and $i.NextRunTime.Year -gt 2000) { $i.NextRunTime.ToUniversalTime().ToString('o') } else { $null }; trigger = $trig; exe = Short $a.Execute 200; args = Short $a.Arguments 400 }
    })
    $out.startup = @(Get-CimInstance Win32_StartupCommand | ForEach-Object { [ordered]@{ name = $_.Name; location = $_.Location; cmd = Short $_.Command 240 } })
    $since = (Get-Date).AddHours(-24)
    $out.serviceEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 7031, 7034; StartTime = $since } -MaxEvents 20 | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; msg = Short ($_.Message -replace '\s+', ' ') 220 } })

    # MCP registry: names, transport and target host only. Args, env and URL paths/queries are never read out.
    $mcp = New-Object System.Collections.ArrayList
    function AddMcp($name, $app, $src, $cmd, $url, $enabled) {
        $base = $null; if ($cmd) { $base = [IO.Path]::GetFileName(([string]$cmd).Trim('"')) }
        $host_ = $null; if ($url) { try { $host_ = ([Uri][string]$url).Host } catch {} }
        [void]$mcp.Add([ordered]@{ name = $name; app = $app; source = $src; transport = if ($url) { 'http' } else { 'stdio' }; command = $base; urlHost = $host_; enabled = $enabled })
    }
    $cj = Join-Path $env:USERPROFILE '.claude.json'
    if (Test-Path $cj) {
        $j = Get-Content $cj -Raw | ConvertFrom-Json
        foreach ($s in @($j.mcpServers.PSObject.Properties)) { if ($s.Name) { AddMcp $s.Name 'Claude Code' 'user' $s.Value.command $s.Value.url $true } }
        foreach ($p in @($j.projects.PSObject.Properties)) { foreach ($s in @($p.Value.mcpServers.PSObject.Properties)) { if ($s.Name) { AddMcp $s.Name 'Claude Code' ('project:' + (Split-Path $p.Name -Leaf)) $s.Value.command $s.Value.url $true } } }
    }
    foreach ($pj in 'C:\work\chocomint-lab\.mcp.json', 'C:\worktrees\mtos-agent-1.4.0\.mcp.json') {
        if (Test-Path $pj) { $j = Get-Content $pj -Raw | ConvertFrom-Json; foreach ($s in @($j.mcpServers.PSObject.Properties)) { if ($s.Name) { AddMcp $s.Name 'Claude Code' ('project:' + (Split-Path (Split-Path $pj) -Leaf)) $s.Value.command $s.Value.url $true } } }
    }
    $ct = Join-Path $env:USERPROFILE '.codex\config.toml'
    if (Test-Path $ct) {
        $cur = $null
        foreach ($line in Get-Content $ct) {
            if ($line -match '^\[mcp_servers\.([^\.\]]+)\]\s*$') { if ($cur) { AddMcp $cur.n 'Codex CLI' 'user' $cur.c $cur.u $true }; $cur = @{ n = $Matches[1].Trim('"'); c = $null; u = $null } }
            elseif ($line -match '^\[') { if ($cur) { AddMcp $cur.n 'Codex CLI' 'user' $cur.c $cur.u $true; $cur = $null } }
            elseif ($cur -and $line -match '^command\s*=\s*"(.*)"') { $cur.c = $Matches[1] }
            elseif ($cur -and $line -match '^url\s*=\s*"(.*)"') { $cur.u = $Matches[1] }
        }
        if ($cur) { AddMcp $cur.n 'Codex CLI' 'user' $cur.c $cur.u $true }
    }
    $hy = Join-Path $env:LOCALAPPDATA 'hermes\config.yaml'
    if (Test-Path $hy) {
        $inBlock = $false; $cur = $null
        foreach ($line in Get-Content $hy) {
            if ($line -match '^mcp_servers:\s*$') { $inBlock = $true; continue }
            if ($inBlock -and $line -match '^\S') { if ($cur) { AddMcp $cur.n 'Hermes' 'user' $cur.c $cur.u $cur.e }; $cur = $null; $inBlock = $false }
            if (-not $inBlock) { continue }
            if ($line -match '^  ([\w\-\.]+):\s*$') { if ($cur) { AddMcp $cur.n 'Hermes' 'user' $cur.c $cur.u $cur.e }; $cur = @{ n = $Matches[1]; c = $null; u = $null; e = $true } }
            elseif ($cur -and $line -match '^    command:\s*(.+)$') { $cur.c = $Matches[1].Trim() }
            elseif ($cur -and $line -match '^    url:\s*(.+)$') { $cur.u = $Matches[1].Trim() }
            elseif ($cur -and $line -match '^    enabled:\s*(\w+)') { $cur.e = ($Matches[1] -eq 'true') }
        }
        if ($cur) { AddMcp $cur.n 'Hermes' 'user' $cur.c $cur.u $cur.e }
    }
    $out.mcpRegistry = @($mcp)
    $out.tools = [ordered]@{
        docker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
        wsl = [bool](Get-Process -Name vmmemWSL, vmmem -ErrorAction SilentlyContinue)
        pm2 = [bool](Get-Command pm2 -ErrorAction SilentlyContinue)
    }
}

$out | ConvertTo-Json -Depth 6 -Compress
