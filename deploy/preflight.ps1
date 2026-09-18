[CmdletBinding()]
param(
    [string]$WpsSyncRoot,
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env',
    [switch]$SkipReleaseIntegrity
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Integrity.psm1') -Force
Import-Module (Join-Path $lib 'Preflight.psm1') -Force

$config = $null
$syncRoot = $null
$integrity = $null
$configurationError = $null
try {
    $config = Read-WpsAiMachineConfig -Path $MachineConfigPath -AllowMissing
}
catch {
    $configurationError = $_.Exception.Message
}

try {
    $syncRoot = Resolve-WpsAiSyncRoot -ExplicitPath $WpsSyncRoot -MachineConfig $config -ScriptPath $PSScriptRoot
    if (-not $SkipReleaseIntegrity) {
        $integrity = Test-WpsReleasePackage -SyncRoot $syncRoot.Path
    }
}
catch {
    if (-not $integrity) {
        $integrity = [pscustomobject]@{ IsValid = $false; Errors = @($_.Exception.Message); CheckedFiles = 0; Stable = $null }
    }
}

$results = @(Invoke-WpsAiPreflight -MachineConfig $config -SyncRoot $syncRoot -IntegrityResult $integrity)
if ($configurationError) {
    $results += [pscustomobject]@{ Name = '本机配置'; Status = 'FAIL'; Detail = $configurationError; ExitCode = 2 }
}
elseif ($config) {
    $results += [pscustomobject]@{ Name = '本机配置'; Status = 'OK'; Detail = $MachineConfigPath; ExitCode = 0 }
}
else {
    $results += [pscustomobject]@{ Name = '本机配置'; Status = 'WARN'; Detail = '尚未创建（首次安装前正常）'; ExitCode = 1 }
}

$results | Format-Table Status, Name, Detail -AutoSize -Wrap
$exitCode = ($results | Measure-Object -Property ExitCode -Maximum).Maximum
if ($null -eq $exitCode) { $exitCode = 10 }
exit [int]$exitCode
