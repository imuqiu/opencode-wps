Set-StrictMode -Version 2.0

Import-Module (Join-Path $PSScriptRoot 'Config.psm1')

function Get-WpsRootIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RootPath)

    $identityPath = Join-Path $RootPath 'ROOT_ID.txt'
    if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
        return $null
    }
    $identity = Read-KeyValueFile -Path $identityPath -RequiredKeys @('WPS_AI_ROOT_ID', 'SCHEMA')
    if ($identity.SCHEMA -ne '1') {
        throw "不支持的 ROOT_ID schema：$($identity.SCHEMA)"
    }
    if ($identity.WPS_AI_ROOT_ID -notmatch '^[0-9a-fA-F-]{36}$') {
        throw "ROOT_ID.txt 中的 UUID 不合法：$identityPath"
    }
    return [string]$identity.WPS_AI_ROOT_ID
}

function Resolve-WpsAiSyncRoot {
    [CmdletBinding()]
    param(
        [string]$ExplicitPath,
        [System.Collections.IDictionary]$MachineConfig,
        [string]$ScriptPath = $PSScriptRoot,
        [string[]]$CandidatePaths = @()
    )

    $candidates = New-Object System.Collections.Generic.List[string]
    if ($ExplicitPath) { $candidates.Add($ExplicitPath) }
    if ($MachineConfig -and $MachineConfig.Contains('WPS_SYNC_ROOT')) {
        $candidates.Add([string]$MachineConfig.WPS_SYNC_ROOT)
    }

    if ($ScriptPath) {
        $item = Get-Item -LiteralPath $ScriptPath -ErrorAction SilentlyContinue
        $directory = if ($item -and -not $item.PSIsContainer) { $item.Directory } elseif ($item) { $item } else { $null }
        for ($i = 0; $directory -and $i -lt 4; $i++) {
            $candidates.Add($directory.FullName)
            $directory = $directory.Parent
        }
    }
    foreach ($candidate in $CandidatePaths) { if ($candidate) { $candidates.Add($candidate) } }

    $valid = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    foreach ($candidate in $candidates) {
        try {
            $fullPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($candidate)).TrimEnd('\')
            if ($seen.ContainsKey($fullPath)) { continue }
            $seen[$fullPath] = $true
            if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) { continue }
            $rootId = Get-WpsRootIdentity -RootPath $fullPath
            if ($rootId) {
                $valid.Add([pscustomobject]@{ Path = $fullPath; RootId = $rootId })
            }
        }
        catch {
            continue
        }
    }

    if ($MachineConfig -and $MachineConfig.Contains('WPS_SYNC_ROOT_ID')) {
        $expected = [string]$MachineConfig.WPS_SYNC_ROOT_ID
        $valid = @($valid | Where-Object { $_.RootId -eq $expected })
    }

    $unique = @($valid | Sort-Object Path -Unique)
    if ($unique.Count -eq 0) {
        throw '未找到包含合法 ROOT_ID.txt 的 WPS-AI 同步根。'
    }
    if ($unique.Count -gt 1) {
        throw ('发现多个合法 WPS-AI 同步根，必须显式指定：{0}' -f (($unique.Path) -join '; '))
    }
    return $unique[0]
}

Export-ModuleMember -Function Get-WpsRootIdentity, Resolve-WpsAiSyncRoot
