[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env',
    [ValidateSet('Install', 'Update', 'Repair')][string]$Mode = 'Install'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Integrity.psm1') -Force
Import-Module (Join-Path $lib 'Deployment.psm1') -Force
Set-DeploymentPath

$config = Read-WpsAiMachineConfig -Path $MachineConfigPath
$root = Resolve-WpsAiSyncRoot -ExplicitPath $config.WPS_SYNC_ROOT -MachineConfig $config -ScriptPath $null
$integrity = Test-WpsReleasePackage -SyncRoot $root.Path
if (-not $integrity.IsValid) { throw (($integrity.Errors) -join '；') }
$stable = $integrity.Stable
$repository = if ($stable.Contains('REPOSITORY')) { [string]$stable.REPOSITORY } else { 'https://github.com/imuqiu/opencode-wps.git' }
$localRoot = Split-Path -Parent $MachineConfigPath
$stateRoot = Join-Path $localRoot 'state'
$runtimeRoot = [string]$config.RUNTIME_ROOT
$target = Join-Path $runtimeRoot 'opencode-wps'
$staging = Join-Path $runtimeRoot ('.staging-' + $stable.COMMIT.Substring(0, 12))
$previous = Join-Path $runtimeRoot '.previous'
$lock = $null
$backup = $null
$originalPolicy = $null

if (-not $PSCmdlet.ShouldProcess($target, "$Mode WPS + opencode-wps $($stable.VERSION)")) { return }
try {
    $lock = Enter-DeploymentLock -StateRoot $stateRoot -Operation $Mode
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    $gitArgs = @()
    if ($config.Contains('GIT_PROXY_URL') -and $config.GIT_PROXY_URL) { $gitArgs += @('-c', "http.proxy=$($config.GIT_PROXY_URL)") }
    & git @gitArgs clone --no-checkout $repository $staging
    if ($LASTEXITCODE -ne 0) { throw '克隆 runtime staging 失败。' }
    & git -C $staging checkout --detach $stable.COMMIT
    if ($LASTEXITCODE -ne 0) { throw '稳定 commit checkout 失败。' }
    if ((& git -C $staging rev-parse HEAD).Trim() -ne $stable.COMMIT) { throw 'staging commit 校验失败。' }
    & npm --prefix $staging ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw '根依赖安装失败。' }
    & npm --prefix (Join-Path $staging 'wps-office-mcp') ci
    if ($LASTEXITCODE -ne 0) { throw 'MCP 依赖安装失败。' }
    & npm --prefix (Join-Path $staging 'wps-office-mcp') run build
    if ($LASTEXITCODE -ne 0) { throw 'MCP 构建失败。' }

    $backup = New-DeploymentBackup -LocalRoot $localRoot
    if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $previous }
    Move-Item -LiteralPath $staging -Destination $target

    $originalPolicy = Set-RuntimeMachinePolicy -RuntimePath $target -Config $config
    try {
        & node (Join-Path $target 'install-addons.js')
        if ($LASTEXITCODE -ne 0) { throw "官方安装器退出码：$LASTEXITCODE" }
    }
    finally {
        if ($originalPolicy) {
            [IO.File]::WriteAllText((Join-Path $target 'opencode-wps\config.js'), $originalPolicy, (New-Object Text.UTF8Encoding($false)))
        }
    }
    Set-OpenCodeWriteRoots -Config $config
    & (Join-Path $PSScriptRoot 'sync-common.ps1') -MachineConfigPath $MachineConfigPath
    if ($LASTEXITCODE -ne 0) { throw '公共配置同步失败。' }
    Save-InstallationState -StateRoot $stateRoot -Commit $stable.COMMIT -Version $stable.VERSION -BackupPath $backup
    Write-Host "$Mode 完成：$($stable.VERSION) / $($stable.COMMIT)" -ForegroundColor Green
}
catch {
    $failure = $_
    Write-Host "部署失败：$($failure.Exception.Message)" -ForegroundColor Red
    if ($backup) { Restore-DeploymentBackup -BackupPath $backup }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $target }
    throw
}
finally {
    if ($lock) { Exit-DeploymentLock -LockPath $lock }
}
