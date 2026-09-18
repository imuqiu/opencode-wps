[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$MachineConfigPath = 'C:\WPS-AI\machine.env')

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Integrity.psm1') -Force
$config = Read-WpsAiMachineConfig -Path $MachineConfigPath
$root = Resolve-WpsAiSyncRoot -ExplicitPath $config.WPS_SYNC_ROOT -MachineConfig $config -ScriptPath $null
$integrity = Test-WpsReleasePackage -SyncRoot $root.Path
if (-not $integrity.IsValid) { throw (($integrity.Errors) -join '；') }

$userProfilePath = [Environment]::GetFolderPath('UserProfile')
$localRoot = Split-Path -Parent $MachineConfigPath
$managedRoot = Join-Path $localRoot 'managed\current'
$owned = @()
foreach ($entry in @($integrity.Manifest.files)) {
    $source = Join-Path $root.Path ([string]$entry.source).Replace('/', '\')
    $relative = ([string]$entry.source) -replace '^common/[^/]+/', ''
    $targets = switch ([string]$entry.targetClass) {
        'opencode-skill' { @((Join-Path $userProfilePath ".config\opencode\skills\$relative"), (Join-Path $userProfilePath ".opencode\skills\$relative")) }
        'opencode-agent' { @((Join-Path $userProfilePath ".config\opencode\agents\$relative"), (Join-Path $userProfilePath ".opencode\agents\$relative")) }
        'opencode-prompt' { @((Join-Path $userProfilePath ".config\opencode\commands\$relative")) }
        'office-template' { @((Join-Path $managedRoot "templates\$relative")) }
        'managed-config' { @((Join-Path $managedRoot "config\$relative")) }
        default { @() }
    }
    foreach ($target in $targets) {
        if (-not $PSCmdlet.ShouldProcess($target, '发布受管公共文件')) { continue }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
        if ((Get-FileSha256 -LiteralPath $target) -ne [string]$entry.sha256) { throw "复制后哈希不一致：$target" }
        $owned += [ordered]@{ path = $target; sha256 = [string]$entry.sha256; source = [string]$entry.source }
    }
}
if (-not $WhatIfPreference) {
    New-Item -ItemType Directory -Path (Join-Path $localRoot 'state') -Force | Out-Null
    [ordered]@{ schema = 1; commit = [string]$integrity.Stable.COMMIT; files = $owned } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $localRoot 'state\managed-files.json') -Encoding UTF8
}
Write-Host "公共内容同步完成：$($owned.Count) 个本机目标。" -ForegroundColor Green
