[CmdletBinding()]
param(
    [string]$WpsSyncRoot,
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Integrity.psm1') -Force
Import-Module (Join-Path $lib 'Preflight.psm1') -Force

$results = New-Object System.Collections.Generic.List[object]
function Add-HealthResult([string]$Name, [string]$Status, [string]$Detail, [int]$Code) {
    $results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail; ExitCode = $Code })
}

try {
    $config = Read-WpsAiMachineConfig -Path $MachineConfigPath
    Add-HealthResult '本机配置' 'OK' $MachineConfigPath 0
}
catch {
    Add-HealthResult '本机配置' 'FAIL' $_.Exception.Message 2
    $results | Format-Table Status, Name, Detail -AutoSize -Wrap
    exit 2
}

try {
    $syncRoot = Resolve-WpsAiSyncRoot -ExplicitPath $WpsSyncRoot -MachineConfig $config -ScriptPath $PSScriptRoot
    Add-HealthResult '同步根' 'OK' ("{0} / {1}" -f $syncRoot.Path, $syncRoot.RootId) 0
    $integrity = Test-WpsReleasePackage -SyncRoot $syncRoot.Path
    if ($integrity.IsValid) {
        Add-HealthResult '公共发布包' 'OK' ("{0} / {1} 个文件" -f $integrity.Stable.VERSION, $integrity.CheckedFiles) 0
    }
    else {
        Add-HealthResult '公共发布包' 'FAIL' (($integrity.Errors) -join '；') 5
    }
}
catch {
    Add-HealthResult '同步根/发布包' 'FAIL' $_.Exception.Message 5
}

$runtimePath = Join-Path ([string]$config.RUNTIME_ROOT) 'opencode-wps'
if (Test-Path -LiteralPath (Join-Path $runtimePath '.git') -PathType Container) {
    $runtimeCommit = (& git -C $runtimePath rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0) {
        Add-HealthResult '本机 Runtime' 'OK' ([string]$runtimeCommit) 0
    }
    else { Add-HealthResult '本机 Runtime' 'FAIL' 'Git 工作树损坏或无法读取 commit' 4 }
}
else { Add-HealthResult '本机 Runtime' 'FAIL' "未安装：$runtimePath" 4 }

$userHome = [Environment]::GetFolderPath('UserProfile')
$openCodeConfig = Join-Path $userHome '.config\opencode\opencode.json'
if (Test-Path -LiteralPath $openCodeConfig -PathType Leaf) {
    try {
        $json = Get-Content -LiteralPath $openCodeConfig -Raw -Encoding UTF8 | ConvertFrom-Json
        Add-HealthResult 'OpenCode 配置' 'OK' $openCodeConfig 0
        if ($json.mcp -and $json.mcp.'wps-office') {
            Add-HealthResult 'MCP 注册' 'OK' '已找到 mcp.wps-office' 0
        }
        else { Add-HealthResult 'MCP 注册' 'FAIL' '缺少 mcp.wps-office' 4 }
    }
    catch { Add-HealthResult 'OpenCode 配置' 'FAIL' $_.Exception.Message 2 }
}
else { Add-HealthResult 'OpenCode 配置' 'FAIL' "不存在：$openCodeConfig" 4 }

$addonPath = Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\opencode-wps_'
if (Test-Path -LiteralPath $addonPath -PathType Container) {
    Add-HealthResult 'WPS Add-in' 'OK' $addonPath 0
}
else { Add-HealthResult 'WPS Add-in' 'FAIL' "不存在：$addonPath" 4 }

$task = Get-ScheduledTask -TaskName 'OpenCodeLauncher' -ErrorAction SilentlyContinue
if ($task) { Add-HealthResult 'Launcher 计划任务' 'OK' ([string]$task.State) 0 }
else { Add-HealthResult 'Launcher 计划任务' 'FAIL' 'OpenCodeLauncher 不存在' 4 }

try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $config.LAUNCHER_PORT) -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Add-HealthResult 'Launcher 健康接口' 'OK' ("HTTP {0}" -f $response.StatusCode) 0
    }
    else { Add-HealthResult 'Launcher 健康接口' 'FAIL' ("HTTP {0}" -f $response.StatusCode) 4 }
}
catch { Add-HealthResult 'Launcher 健康接口' 'WARN' '当前不可达' 1 }

$results | Format-Table Status, Name, Detail -AutoSize -Wrap
$exitCode = ($results | Measure-Object -Property ExitCode -Maximum).Maximum
exit [int]$exitCode
