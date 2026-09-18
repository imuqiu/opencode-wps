Set-StrictMode -Version 2.0

function Set-DeploymentPath {
    [CmdletBinding()]
    param()
    $parts = @(
        'C:\Program Files\Git\cmd',
        'C:\Program Files\nodejs',
        (Join-Path $env:APPDATA 'npm'),
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { $_ }
    $env:PATH = ($parts -join ';')
}

function Enter-DeploymentLock {
    [CmdletBinding()]
    param([string]$StateRoot = 'C:\WPS-AI\state', [string]$Operation = 'deploy')

    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    $lockPath = Join-Path $StateRoot 'lock'
    if (Test-Path -LiteralPath $lockPath) {
        try {
            $existing = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            if ($existing.pid -and (Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue)) {
                throw "已有部署操作正在运行：PID $($existing.pid)，操作 $($existing.operation)"
            }
        }
        catch [System.Management.Automation.RuntimeException] { throw }
        catch { }
    }
    $payload = [ordered]@{
        pid = $PID
        operation = $Operation
        device = $env:COMPUTERNAME
        startedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json
    [IO.File]::WriteAllText($lockPath, $payload, (New-Object Text.UTF8Encoding($false)))
    return $lockPath
}

function Exit-DeploymentLock {
    [CmdletBinding()]
    param([string]$LockPath)
    if ($LockPath -and (Test-Path -LiteralPath $LockPath)) {
        Remove-Item -LiteralPath $LockPath -Force
    }
}

function New-DeploymentBackup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$LocalRoot)

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $LocalRoot "backups\$stamp"
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $userProfilePath = [Environment]::GetFolderPath('UserProfile')
    $items = [ordered]@{
        'opencode.json' = (Join-Path $userProfilePath '.config\opencode\opencode.json')
        'addon' = (Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\opencode-wps_')
        'publish.xml' = (Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\publish.xml')
        'jsplugins.xml' = (Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\jsplugins.xml')
        'authaddin.json' = (Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\authaddin.json')
    }
    $manifest = [ordered]@{ createdAt = (Get-Date).ToString('o'); taskExisted = $false; items = @() }
    foreach ($name in $items.Keys) {
        $source = $items[$name]
        $record = [ordered]@{ name = $name; source = $source; existed = $false; backup = $null }
        if (Test-Path -LiteralPath $source) {
            $destination = Join-Path $backup $name
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
            $record.existed = $true
            $record.backup = $destination
        }
        $manifest.items += $record
    }
    $task = Get-ScheduledTask -TaskName 'OpenCodeLauncher' -ErrorAction SilentlyContinue
    if ($task) {
        $manifest.taskExisted = $true
        Export-ScheduledTask -TaskName 'OpenCodeLauncher' | Set-Content -LiteralPath (Join-Path $backup 'OpenCodeLauncher.xml') -Encoding UTF8
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'backup.json') -Encoding UTF8
    return $backup
}

function Restore-DeploymentBackup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$BackupPath)

    $manifestPath = Join-Path $BackupPath 'backup.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($item in @($manifest.items)) {
        if (Test-Path -LiteralPath $item.source) { Remove-Item -LiteralPath $item.source -Recurse -Force }
        if ($item.existed) {
            $parent = Split-Path -Parent $item.source
            if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -LiteralPath $item.backup -Destination $item.source -Recurse -Force
        }
    }
    Unregister-ScheduledTask -TaskName 'OpenCodeLauncher' -Confirm:$false -ErrorAction SilentlyContinue
    $taskXml = Join-Path $BackupPath 'OpenCodeLauncher.xml'
    if ($manifest.taskExisted -and (Test-Path -LiteralPath $taskXml)) {
        Register-ScheduledTask -TaskName 'OpenCodeLauncher' -Xml (Get-Content -LiteralPath $taskXml -Raw) -Force | Out-Null
        Start-ScheduledTask -TaskName 'OpenCodeLauncher' -ErrorAction SilentlyContinue
    }
}

function Stop-DeploymentServices {
    [CmdletBinding()]
    param([int]$LauncherPort = 14097)

    try {
        Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/stop" -f $LauncherPort) -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
    }
    catch { }

    Stop-ScheduledTask -TaskName 'OpenCodeLauncher' -ErrorAction SilentlyContinue
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $LauncherPort -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -match '(?i)launcher\.js') {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-DeploymentLauncher {
    [CmdletBinding()]
    param([int]$LauncherPort = 14097, [int]$TimeoutSeconds = 15)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $LauncherPort) -TimeoutSec 2
            if ($response.healthy) { return $true }
        }
        catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Set-RuntimeMachinePolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$RuntimePath,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Config
    )
    $configPath = Join-Path $RuntimePath 'opencode-wps\config.js'
    $original = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
    $mode = [string]$Config.PERMISSION_MODE
    if (-not $mode) { $mode = 'manual' }
    $modeRegex = New-Object Text.RegularExpressions.Regex("mode:\s*'(auto|manual)'")
    $patched = $modeRegex.Replace($original, "mode: '$mode'", 1)
    [IO.File]::WriteAllText($configPath, $patched, (New-Object Text.UTF8Encoding($false)))
    return $original
}

function Set-OpenCodeWriteRoots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Config,
        [string]$ConfigPath
    )
    if (-not $ConfigPath) {
        $userProfilePath = [Environment]::GetFolderPath('UserProfile')
        $ConfigPath = Join-Path $userProfilePath '.config\opencode\opencode.json'
    }
    $json = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $json.PSObject.Properties['mcp'] -or -not $json.mcp.PSObject.Properties['wps-office']) { throw 'OpenCode 配置缺少 mcp.wps-office。' }
    $server = $json.mcp.'wps-office'
    if (-not $server.PSObject.Properties['env']) { $server | Add-Member -MemberType NoteProperty -Name env -Value ([pscustomobject]@{}) }
    $server.env | Add-Member -MemberType NoteProperty -Name OPCODE_ALLOWED_ROOTS -Value ([string]$Config.WPS_SYNC_ROOT) -Force
    [IO.File]::WriteAllText($ConfigPath, ($json | ConvertTo-Json -Depth 30) + "`n", (New-Object Text.UTF8Encoding($false)))
}

function Save-InstallationState {
    [CmdletBinding()]
    param([string]$StateRoot, [string]$Commit, [string]$Version, [string]$BackupPath)
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    $state = [ordered]@{
        schema = 1
        commit = $Commit
        version = $Version
        installedAt = (Get-Date).ToString('o')
        backupPath = $BackupPath
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StateRoot 'last-good.json') -Encoding UTF8
}

Export-ModuleMember -Function Set-DeploymentPath, Enter-DeploymentLock, Exit-DeploymentLock, New-DeploymentBackup, Restore-DeploymentBackup, Stop-DeploymentServices, Test-DeploymentLauncher, Set-RuntimeMachinePolicy, Set-OpenCodeWriteRoots, Save-InstallationState
