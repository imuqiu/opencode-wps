[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$MachineConfigPath = 'C:\WPS-AI\machine.env',
    [switch]$PurgeLocalState
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot 'lib'
Import-Module (Join-Path $lib 'Integrity.psm1') -Force
$localRoot = Split-Path -Parent $MachineConfigPath
$userProfilePath = [Environment]::GetFolderPath('UserProfile')
$targets = @(
    (Join-Path $env:APPDATA 'kingsoft\wps\jsaddons\opencode-wps_')
)
if ($PSCmdlet.ShouldProcess('OpenCodeLauncher', '删除部署器计划任务')) {
    Unregister-ScheduledTask -TaskName 'OpenCodeLauncher' -Confirm:$false -ErrorAction SilentlyContinue
}
foreach ($target in $targets) {
    if ((Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, '删除受管 WPS Add-in')) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
$jsaddons = Join-Path $env:APPDATA 'kingsoft\wps\jsaddons'
foreach ($xmlName in @('publish.xml', 'jsplugins.xml')) {
    $xmlPath = Join-Path $jsaddons $xmlName
    if ((Test-Path -LiteralPath $xmlPath) -and $PSCmdlet.ShouldProcess($xmlPath, '移除 opencode-wps 注册条目')) {
        $content = [IO.File]::ReadAllText($xmlPath, [Text.Encoding]::UTF8)
        $content = [regex]::Replace($content, '(?m)^\s*<jsplugin[^>]*name="opencode-wps"[^>]*/>\s*\r?\n?', '')
        [IO.File]::WriteAllText($xmlPath, $content, (New-Object Text.UTF8Encoding($false)))
    }
}
$authPath = Join-Path $jsaddons 'authaddin.json'
if ((Test-Path -LiteralPath $authPath) -and $PSCmdlet.ShouldProcess($authPath, '禁用 opencode-wps 加载项')) {
    $auth = Get-Content -LiteralPath $authPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($app in @('wps', 'et', 'wpp')) {
        if ($auth.$app) {
            foreach ($property in @($auth.$app.PSObject.Properties)) {
                if ($property.Name -ne 'namelist' -and $property.Value.name -eq 'opencode-wps') { $property.Value.enable = $false }
            }
        }
    }
    $auth | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $authPath -Encoding UTF8
}
$managedPath = Join-Path $localRoot 'state\managed-files.json'
if (Test-Path -LiteralPath $managedPath) {
    $managed = Get-Content -LiteralPath $managedPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($file in @($managed.files)) {
        if ((Test-Path -LiteralPath $file.path -PathType Leaf) -and
            ((Get-FileSha256 -LiteralPath $file.path) -eq $file.sha256) -and
            $PSCmdlet.ShouldProcess($file.path, '删除未被用户修改的受管文件')) {
            Remove-Item -LiteralPath $file.path -Force
        }
    }
}
$opencodeConfig = Join-Path $userProfilePath '.config\opencode\opencode.json'
if (Test-Path -LiteralPath $opencodeConfig) {
    $json = Get-Content -LiteralPath $opencodeConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($json.mcp -and $json.mcp.'wps-office' -and $PSCmdlet.ShouldProcess($opencodeConfig, '移除 mcp.wps-office')) {
        $json.mcp.PSObject.Properties.Remove('wps-office')
        $json | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $opencodeConfig -Encoding UTF8
    }
}
if ($PurgeLocalState -and $PSCmdlet.ShouldProcess($localRoot, '删除全部本机部署状态')) {
    Remove-Item -LiteralPath $localRoot -Recurse -Force
}
Write-Host '卸载完成；WPS 云同步目录和 GitHub 仓库未删除。' -ForegroundColor Green
