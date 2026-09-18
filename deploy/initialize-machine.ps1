[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [string]$WpsSyncRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$')]
    [string]$DeviceName,

    [ValidateSet('primary', 'secondary')]
    [string]$DeviceRole = 'secondary',

    [string]$RuntimeRoot = 'C:\WPS-AI\runtime',
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env',
    [ValidateRange(1024, 65535)][int]$LocalPort = 14096,
    [ValidateRange(1024, 65535)][int]$LauncherPort = 14097,
    [ValidateRange(1024, 65535)][int]$BackupProxyPort = 14098,
    [ValidateSet('manual', 'auto')][string]$PermissionMode = 'manual',
    [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force

$uniquePorts = @($LocalPort, $LauncherPort, $BackupProxyPort) | Select-Object -Unique
if (@($uniquePorts).Count -ne 3) {
    throw 'LOCAL_PORT、LAUNCHER_PORT 和 BACKUP_PROXY_PORT 必须互不相同。'
}

$root = Resolve-WpsAiSyncRoot -ExplicitPath $WpsSyncRoot -ScriptPath $null
if ((Test-Path -LiteralPath $MachineConfigPath -PathType Leaf) -and -not $Force) {
    $existing = Read-WpsAiMachineConfig -Path $MachineConfigPath
    if ($existing.WPS_SYNC_ROOT_ID -ne $root.RootId) {
        throw '现有 machine.env 属于另一个 WPS-AI 同步根；如确需替换，请使用 -Force。'
    }
    throw 'machine.env 已存在；为避免覆盖本机设置，默认停止。确需重建时使用 -Force。'
}

$values = [ordered]@{
    CONFIG_SCHEMA       = '1'
    WPS_SYNC_ROOT       = $root.Path
    WPS_SYNC_ROOT_ID    = $root.RootId
    DEVICE_NAME         = $DeviceName
    DEVICE_ROLE         = $DeviceRole
    RUNTIME_ROOT        = [System.IO.Path]::GetFullPath($RuntimeRoot)
    LOCAL_PORT          = [string]$LocalPort
    LAUNCHER_PORT       = [string]$LauncherPort
    BACKUP_PROXY_PORT   = [string]$BackupProxyPort
    PERMISSION_MODE     = $PermissionMode
}

Write-WpsAiMachineConfig -Values $values -Path $MachineConfigPath -WhatIf:$WhatIfPreference
if (-not $WhatIfPreference) {
    $verified = Read-WpsAiMachineConfig -Path $MachineConfigPath
    Write-Host "已生成本机配置：$MachineConfigPath" -ForegroundColor Green
    Write-Host ("设备：{0} ({1})" -f $verified.DEVICE_NAME, $verified.DEVICE_ROLE)
    Write-Host ("同步根：{0}" -f $verified.WPS_SYNC_ROOT)
}
