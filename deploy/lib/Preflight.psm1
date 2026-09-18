Set-StrictMode -Version 2.0

function New-CheckResult {
    param([string]$Name, [string]$Status, [string]$Detail, [int]$ExitCode = 0)
    [pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail; ExitCode = $ExitCode }
}

function Find-WpsInstallations {
    [CmdletBinding()]
    param()

    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Kingsoft\WPS Office'),
        (Join-Path $env:ProgramFiles 'Kingsoft\WPS Office')
    )
    if (${env:ProgramFiles(x86)}) {
        $roots += Join-Path ${env:ProgramFiles(x86)} 'Kingsoft\WPS Office'
    }

    $found = foreach ($root in $roots | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $exe = Join-Path $_.FullName 'office6\wps.exe'
            if (Test-Path -LiteralPath $exe -PathType Leaf) {
                [pscustomobject]@{ VersionDirectory = $_.Name; ExePath = $exe }
            }
        }
    }
    return @($found | Sort-Object VersionDirectory -Descending)
}

function Get-ListeningPorts {
    [CmdletBinding()]
    param()
    try {
        return @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object { $_.Port })
    }
    catch {
        return @()
    }
}

function Get-PreferredCommand {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)

    $known = @{
        git      = @('C:\Program Files\Git\cmd\git.exe')
        node     = @('C:\Program Files\nodejs\node.exe')
        npm      = @('C:\Program Files\nodejs\npm.cmd')
        opencode = @((Join-Path $env:APPDATA 'npm\opencode.cmd'))
    }
    foreach ($path in @($known[$Name])) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            return [pscustomobject]@{ Name = $Name; Source = $path; Path = $path }
        }
    }
    return Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Invoke-WpsAiPreflight {
    [CmdletBinding()]
    param(
        [System.Collections.IDictionary]$MachineConfig,
        [pscustomobject]$SyncRoot,
        [pscustomobject]$IntegrityResult
    )

    $results = New-Object System.Collections.Generic.List[object]
    $isWindows = $env:OS -eq 'Windows_NT'
    $results.Add((New-CheckResult 'Windows' $(if ($isWindows) { 'OK' } else { 'FAIL' }) $(if ($isWindows) { [Environment]::OSVersion.VersionString } else { '仅支持 Windows' }) $(if ($isWindows) { 0 } else { 3 })))

    $wps = Find-WpsInstallations
    if ($wps.Count -gt 0) {
        $results.Add((New-CheckResult 'WPS' 'OK' ("{0}；{1}" -f $wps[0].VersionDirectory, $wps[0].ExePath)))
    }
    else {
        $results.Add((New-CheckResult 'WPS' 'FAIL' '未找到 WPS Office 的 wps.exe' 3))
    }

    foreach ($commandName in @('git', 'node', 'npm', 'opencode')) {
        $command = Get-PreferredCommand -Name $commandName
        if (-not $command) {
            $results.Add((New-CheckResult $commandName 'FAIL' '当前普通用户 PATH 中未找到' 3))
            continue
        }
        $source = if ($command.Source) { $command.Source } else { $command.Path }
        if ($source -and $source -match '(?i)(\\\.codex\\|\\\.cache\\codex-runtimes\\)') {
            $results.Add((New-CheckResult $commandName 'FAIL' "仅找到 Codex 私有运行时：$source" 3))
        }
        else {
            $results.Add((New-CheckResult $commandName 'OK' ([string]$source)))
        }
    }

    if ($SyncRoot) {
        $results.Add((New-CheckResult '同步根' 'OK' ("{0} / {1}" -f $SyncRoot.Path, $SyncRoot.RootId)))
    }
    else {
        $results.Add((New-CheckResult '同步根' 'FAIL' '未识别 WPS-AI 同步根' 5))
    }

    if ($IntegrityResult) {
        if ($IntegrityResult.IsValid) {
            $versionDetail = if ($IntegrityResult.Stable) { "版本 $($IntegrityResult.Stable.VERSION)，$($IntegrityResult.CheckedFiles) 个文件" } else { '发布包完整' }
            $results.Add((New-CheckResult '发布包' 'OK' $versionDetail))
        }
        else {
            $results.Add((New-CheckResult '发布包' 'FAIL' (($IntegrityResult.Errors) -join '；') 5))
        }
    }

    $ports = if ($MachineConfig) {
        @($MachineConfig.LOCAL_PORT, $MachineConfig.LAUNCHER_PORT, $MachineConfig.BACKUP_PROXY_PORT) | Where-Object { $_ }
    }
    else { @(14096, 14097, 14098) }
    $listening = Get-ListeningPorts
    foreach ($port in $ports | Select-Object -Unique) {
        $number = [int]$port
        if ($listening -contains $number) {
            $results.Add((New-CheckResult "端口 $number" 'WARN' '当前已被监听；已有安装时可能正常' 1))
        }
        else {
            $results.Add((New-CheckResult "端口 $number" 'OK' '空闲'))
        }
    }

    return $results.ToArray()
}

Export-ModuleMember -Function Find-WpsInstallations, Get-ListeningPorts, Get-PreferredCommand, Invoke-WpsAiPreflight
