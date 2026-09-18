[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Refresh-DeploymentPath {
    $parts = @(
        'C:\Program Files\Git\cmd'
        'C:\Program Files\nodejs'
        (Join-Path $env:APPDATA 'npm')
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { $_ } | Select-Object -Unique
    $env:PATH = $parts -join ';'
}

function Install-WingetPackage {
    param([Parameter(Mandatory = $true)][string]$Id, [Parameter(Mandatory = $true)][string]$Label)
    if (-not $PSCmdlet.ShouldProcess($Id, "使用 winget 安装 $Label")) { return }
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "$Label 安装失败，winget 退出码：$LASTEXITCODE" }
}

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw '未找到 winget。请先从 Microsoft Store 安装或更新“应用安装程序”。'
}

Refresh-DeploymentPath
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Install-WingetPackage -Id 'Git.Git' -Label 'Git for Windows'
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Install-WingetPackage -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
}

Refresh-DeploymentPath
if (-not (Get-Command opencode.cmd -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess('opencode-ai', '使用 npm 全局安装 OpenCode')) {
        & npm.cmd install --global opencode-ai
        if ($LASTEXITCODE -ne 0) { throw "OpenCode 安装失败，npm 退出码：$LASTEXITCODE" }
    }
}

Refresh-DeploymentPath
$wps = Get-ItemProperty 'HKCU:\Software\Kingsoft\Office\*' -ErrorAction SilentlyContinue
if (-not $wps) {
    Write-Warning '未从当前用户注册表确认 WPS。请安装 WPS、登录同一账号并完成同步文件夹设置。'
}

$versions = [ordered]@{
    Git = if (Get-Command git.exe -ErrorAction SilentlyContinue) { (& git.exe --version) -join ' ' } else { 'missing' }
    Node = if (Get-Command node.exe -ErrorAction SilentlyContinue) { (& node.exe --version) -join ' ' } else { 'missing' }
    npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { (& npm.cmd --version) -join ' ' } else { 'missing' }
    OpenCode = if (Get-Command opencode.cmd -ErrorAction SilentlyContinue) { (& opencode.cmd --version) -join ' ' } else { 'missing' }
}
$versions.GetEnumerator() | ForEach-Object { [pscustomobject]@{ Component = $_.Key; Version = $_.Value } } | Format-Table -AutoSize

if ($versions.Values -contains 'missing') { exit 3 }
Write-Host '系统依赖已就绪。下一步运行 initialize-machine.cmd。' -ForegroundColor Green
