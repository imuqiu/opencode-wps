[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$lib = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Integrity.psm1') -Force

$passed = 0
$failed = 0
function Assert-True([bool]$Condition, [string]$Name) {
    if ($Condition) {
        $script:passed++
        Write-Host "[PASS] $Name" -ForegroundColor Green
    }
    else {
        $script:failed++
        Write-Host "[FAIL] $Name" -ForegroundColor Red
    }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('wps-ai-deploy-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $rootId = [guid]::NewGuid().ToString()
    [System.IO.File]::WriteAllLines((Join-Path $testRoot 'ROOT_ID.txt'), @("WPS_AI_ROOT_ID=$rootId", 'SCHEMA=1'))

    $machine = Join-Path $testRoot 'machine.env'
    [System.IO.File]::WriteAllLines($machine, @(
        'CONFIG_SCHEMA=1', "WPS_SYNC_ROOT=$testRoot", "WPS_SYNC_ROOT_ID=$rootId",
        'DEVICE_NAME=TEST-PC', 'DEVICE_ROLE=secondary', "RUNTIME_ROOT=$testRoot\runtime",
        'LOCAL_PORT=14096', 'LAUNCHER_PORT=14097', 'BACKUP_PROXY_PORT=14098', 'PERMISSION_MODE=manual'
    ))
    $config = Read-WpsAiMachineConfig -Path $machine
    Assert-True ($config.DEVICE_NAME -eq 'TEST-PC') '严格读取 machine.env'

    $roundTrip = Join-Path $testRoot 'roundtrip.env'
    Write-WpsAiMachineConfig -Values $config -Path $roundTrip
    $roundTripConfig = Read-WpsAiMachineConfig -Path $roundTrip
    Assert-True ($roundTripConfig.WPS_SYNC_ROOT_ID -eq $rootId) '原子写入并回读 machine.env'

    $resolved = Resolve-WpsAiSyncRoot -ExplicitPath $testRoot -MachineConfig $config
    Assert-True ($resolved.RootId -eq $rootId) '按 ROOT_ID 解析同步根'

    $duplicate = Join-Path $testRoot 'duplicate.env'
    [System.IO.File]::WriteAllLines($duplicate, @('A=1', 'A=2'))
    $duplicateRejected = $false
    try { Read-KeyValueFile -Path $duplicate | Out-Null } catch { $duplicateRejected = $true }
    Assert-True $duplicateRejected '拒绝重复配置键'

    $traversalRejected = $false
    try { Resolve-SafeChildPath -Root $testRoot -RelativePath '..\outside.txt' | Out-Null } catch { $traversalRejected = $true }
    Assert-True $traversalRejected '拒绝 manifest 路径穿越'

    $wrongConfig = [ordered]@{ WPS_SYNC_ROOT_ID = [guid]::NewGuid().ToString() }
    $wrongRootRejected = $false
    try { Resolve-WpsAiSyncRoot -ExplicitPath $testRoot -MachineConfig $wrongConfig | Out-Null } catch { $wrongRootRejected = $true }
    Assert-True $wrongRootRejected '拒绝与本机登记 ROOT_ID 不同的同步根'

    $common = Join-Path $testRoot 'common\skills\wps-ai-test'
    $versions = Join-Path $testRoot 'versions\releases'
    New-Item -ItemType Directory -Path $common -Force | Out-Null
    New-Item -ItemType Directory -Path $versions -Force | Out-Null
    $contentPath = Join-Path $common 'SKILL.md'
    [System.IO.File]::WriteAllText($contentPath, "# test`n", (New-Object System.Text.UTF8Encoding($false)))
    $contentHash = (Get-FileHash -LiteralPath $contentPath -Algorithm SHA256).Hash
    $commit = 'a' * 40
    $manifestPath = Join-Path $versions "$commit.manifest.json"
    $manifest = [ordered]@{
        schema = 1
        commit = $commit
        createdAt = '2026-09-13T12:00:00+08:00'
        files = @([ordered]@{
            source = 'common/skills/wps-ai-test/SKILL.md'
            targetClass = 'opencode-skill'
            sha256 = $contentHash
            size = (Get-Item -LiteralPath $contentPath).Length
        })
    } | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    [System.IO.File]::WriteAllLines((Join-Path $testRoot 'versions\stable-version.txt'), @(
        'SCHEMA=1', 'VERSION=1.9.17', "COMMIT=$commit", 'BRANCH=my-deploy',
        "MANIFEST_SHA256=$manifestHash", 'PUBLISHED_AT=2026-09-13T12:00:00+08:00', 'PUBLISHED_BY=TEST-PC'
    ))

    $integrity = Test-WpsReleasePackage -SyncRoot $testRoot -StableReadDelayMilliseconds 0
    Assert-True ($integrity.IsValid -and $integrity.CheckedFiles -eq 1) '通过完整发布包哈希校验'

    [System.IO.File]::AppendAllText($contentPath, 'tampered')
    $tampered = Test-WpsReleasePackage -SyncRoot $testRoot -StableReadDelayMilliseconds 0
    Assert-True (-not $tampered.IsValid) '拒绝被篡改或未同步完整的公共文件'

    $integrationRoot = Join-Path $testRoot '中文 云同步\WPS-AI'
    $integrationMachine = Join-Path $testRoot 'local\machine.env'
    $deployRoot = Split-Path -Parent $PSScriptRoot
    & (Join-Path $deployRoot 'initialize-sync-root.ps1') -Path $integrationRoot
    Assert-True (Test-Path -LiteralPath (Join-Path $integrationRoot 'ROOT_ID.txt') -PathType Leaf) '初始化公共同步根和 ROOT_ID'

    & (Join-Path $deployRoot 'initialize-machine.ps1') `
        -WpsSyncRoot $integrationRoot `
        -DeviceName 'TEST-PC' `
        -DeviceRole 'secondary' `
        -MachineConfigPath $integrationMachine `
        -RuntimeRoot (Join-Path $testRoot 'local\runtime')
    $initializedConfig = Read-WpsAiMachineConfig -Path $integrationMachine
    Assert-True (
        $initializedConfig.DEVICE_NAME -eq 'TEST-PC' -and
        $initializedConfig.WPS_SYNC_ROOT -eq [System.IO.Path]::GetFullPath($integrationRoot)
    ) '初始化本机配置并支持中文空格路径'
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

Write-Host "`nTests: $passed passed, $failed failed"
if ($failed -gt 0) { exit 1 }
exit 0
