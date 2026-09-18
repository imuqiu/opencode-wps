[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env',
    [string]$RepositoryRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if (-not $RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Config.psm1') -Force
Import-Module (Join-Path $lib 'Discovery.psm1') -Force
Import-Module (Join-Path $lib 'Deployment.psm1') -Force
Set-DeploymentPath

$config = Read-WpsAiMachineConfig -Path $MachineConfigPath
if ($config.DEVICE_ROLE -ne 'primary') { throw '只有 primary 设备可以发布稳定版本。' }
$root = Resolve-WpsAiSyncRoot -ExplicitPath $config.WPS_SYNC_ROOT -MachineConfig $config -ScriptPath $null
$branch = (& git -C $RepositoryRoot branch --show-current).Trim()
if ($branch -ne 'my-deploy') { throw "必须从 my-deploy 发布，当前分支：$branch" }
if (& git -C $RepositoryRoot status --porcelain) { throw '仓库存在未提交修改，禁止发布。' }
$commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
$remoteCommit = (& git -C $RepositoryRoot rev-parse origin/my-deploy).Trim()
if ($commit -ne $remoteCommit) { throw '本地 HEAD 尚未与 origin/my-deploy 对齐。' }
$package = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version

if (-not $PSCmdlet.ShouldProcess($root.Path, "发布稳定版本 $version / $commit")) { return }
$publishing = Join-Path $root.Path 'versions\PUBLISHING.json'
[ordered]@{ device = $config.DEVICE_NAME; commit = $commit; startedAt = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $publishing -Encoding UTF8
try {
    $mappings = @(
        @{ Source = (Join-Path $RepositoryRoot 'deploy'); Destination = (Join-Path $root.Path 'scripts'); Class = 'deploy-script' },
        @{ Source = (Join-Path $RepositoryRoot 'custom\skills'); Destination = (Join-Path $root.Path 'common\skills'); Class = 'opencode-skill' },
        @{ Source = (Join-Path $RepositoryRoot 'custom\agents'); Destination = (Join-Path $root.Path 'common\agents'); Class = 'opencode-agent' },
        @{ Source = (Join-Path $RepositoryRoot 'custom\prompts'); Destination = (Join-Path $root.Path 'common\prompts'); Class = 'opencode-prompt' },
        @{ Source = (Join-Path $RepositoryRoot 'custom\templates'); Destination = (Join-Path $root.Path 'common\templates'); Class = 'office-template' },
        @{ Source = (Join-Path $RepositoryRoot 'custom\config'); Destination = (Join-Path $root.Path 'common\config'); Class = 'managed-config' }
    )
    $entries = @()
    foreach ($mapping in $mappings) {
        if (-not (Test-Path -LiteralPath $mapping.Source)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $mapping.Source -Recurse -File | Where-Object { $_.Name -ne '.gitkeep' }) {
            $relative = $file.FullName.Substring($mapping.Source.Length).TrimStart('\')
            $destination = Join-Path $mapping.Destination $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
            $cloudRelative = $destination.Substring($root.Path.Length).TrimStart('\').Replace('\', '/')
            $copied = Get-Item -LiteralPath $destination
            $entries += [ordered]@{
                source = $cloudRelative
                targetClass = $mapping.Class
                sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
                size = $copied.Length
            }
        }
    }
    $release = [ordered]@{ schema = 1; commit = $commit; createdAt = (Get-Date).ToString('o'); files = $entries }
    $releaseDir = Join-Path $root.Path 'versions\releases'
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    $manifestPath = Join-Path $releaseDir "$commit.manifest.json"
    $temporaryManifest = "$manifestPath.tmp"
    [IO.File]::WriteAllText($temporaryManifest, ($release | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporaryManifest -Destination $manifestPath -Force
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    $stableLines = @(
        'SCHEMA=1', "VERSION=$version", "COMMIT=$commit", 'BRANCH=my-deploy',
        'REPOSITORY=https://github.com/imuqiu/opencode-wps.git',
        "MANIFEST_SHA256=$manifestHash", "PUBLISHED_AT=$((Get-Date).ToString('o'))", "PUBLISHED_BY=$($config.DEVICE_NAME)"
    )
    $stablePath = Join-Path $root.Path 'versions\stable-version.txt'
    $temporaryStable = "$stablePath.tmp"
    [IO.File]::WriteAllLines($temporaryStable, $stableLines, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporaryStable -Destination $stablePath -Force
    Write-Host "已发布稳定版本 $version / $commit，共 $($entries.Count) 个文件。" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $publishing) { Remove-Item -LiteralPath $publishing -Force }
}
