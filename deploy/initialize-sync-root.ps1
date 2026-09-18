[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [switch]$InitializeExisting
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$fullPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
if ([System.IO.Path]::GetPathRoot($fullPath) -eq $fullPath) {
    throw '禁止把磁盘根目录作为 WPS-AI 同步根。'
}

$identityPath = Join-Path $fullPath 'ROOT_ID.txt'
if (Test-Path -LiteralPath $identityPath -PathType Leaf) {
    Write-Host "同步根已经初始化：$fullPath"
    Get-Content -LiteralPath $identityPath
    exit 0
}

if (Test-Path -LiteralPath $fullPath -PathType Container) {
    $existing = @(Get-ChildItem -LiteralPath $fullPath -Force -ErrorAction Stop)
    if ($existing.Count -gt 0 -and -not $InitializeExisting) {
        throw '目标目录非空且没有 ROOT_ID.txt。确认这是正确的 WPS-AI 目录后，使用 -InitializeExisting。'
    }
}

if (-not $PSCmdlet.ShouldProcess($fullPath, '初始化 WPS-AI 公共同步根')) {
    exit 0
}

$directories = @(
    'common\skills', 'common\agents', 'common\prompts', 'common\templates', 'common\config',
    'scripts\deploy', 'versions\releases', 'versions\packages', 'docs',
    'jobs\inbox', 'jobs\working', 'jobs\output', 'jobs\failed'
)
New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
foreach ($relative in $directories) {
    New-Item -ItemType Directory -Path (Join-Path $fullPath $relative) -Force | Out-Null
}

$rootId = [guid]::NewGuid().ToString()
$identityLines = @("WPS_AI_ROOT_ID=$rootId", 'SCHEMA=1')
$temporary = Join-Path $fullPath ('.ROOT_ID.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
    [System.IO.File]::WriteAllLines($temporary, $identityLines, $utf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $identityPath
}
finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

Write-Host "已初始化 WPS-AI 同步根：$fullPath" -ForegroundColor Green
Write-Host "ROOT_ID：$rootId"
Write-Host '下一步：等待 WPS 将 ROOT_ID.txt 和目录同步到另外两台电脑。'
