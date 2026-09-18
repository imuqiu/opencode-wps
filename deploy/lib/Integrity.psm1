Set-StrictMode -Version 2.0

Import-Module (Join-Path $PSScriptRoot 'Config.psm1')

function Resolve-SafeChildPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "manifest 路径不能是绝对路径：$RelativePath"
    }
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
    $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "manifest 路径越过同步根：$RelativePath"
    }
    return $candidate
}

function Read-StableVersion {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$SyncRoot)

    $path = Join-Path $SyncRoot 'versions\stable-version.txt'
    $stable = Read-KeyValueFile -Path $path -RequiredKeys @(
        'SCHEMA', 'VERSION', 'COMMIT', 'BRANCH', 'MANIFEST_SHA256', 'PUBLISHED_AT', 'PUBLISHED_BY'
    )
    if ($stable.SCHEMA -ne '1') { throw "不支持的稳定清单 schema：$($stable.SCHEMA)" }
    if ($stable.COMMIT -notmatch '^[0-9a-fA-F]{40}$') { throw '稳定清单 COMMIT 必须是 40 位 SHA。' }
    if ($stable.MANIFEST_SHA256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'MANIFEST_SHA256 必须是 64 位 SHA-256。' }
    return $stable
}

function Test-WpsReleasePackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SyncRoot,
        [int]$StableReadDelayMilliseconds = 200
    )

    # 哈希计算是只读操作。调用者使用 -WhatIf 时，不能让偏好变量阻止 provider 读取。
    $WhatIfPreference = $false

    $errors = New-Object System.Collections.Generic.List[string]
    $checkedFiles = 0
    $stable = $null
    $manifest = $null
    try {
        $stablePath = Join-Path $SyncRoot 'versions\stable-version.txt'
        $firstBytes = [System.IO.File]::ReadAllBytes($stablePath)
        if ($StableReadDelayMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $StableReadDelayMilliseconds
        }
        $secondBytes = [System.IO.File]::ReadAllBytes($stablePath)
        if ([Convert]::ToBase64String($firstBytes) -ne [Convert]::ToBase64String($secondBytes)) {
            throw 'stable-version.txt 在连续读取期间发生变化，请等待 WPS 同步完成。'
        }
        $stable = Read-StableVersion -SyncRoot $SyncRoot

        $manifestRelative = 'versions\releases\{0}.manifest.json' -f $stable.COMMIT
        $manifestPath = Resolve-SafeChildPath -Root $SyncRoot -RelativePath $manifestRelative
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "发布 manifest 不存在：$manifestRelative"
        }
        $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
        if ($manifestHash -ne $stable.MANIFEST_SHA256) {
            throw '发布 manifest 的 SHA-256 与稳定清单不一致。'
        }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.schema -ne 1) { throw "不支持的发布 manifest schema：$($manifest.schema)" }
        if ([string]$manifest.commit -ne [string]$stable.COMMIT) { throw '发布 manifest commit 与稳定清单不一致。' }
        if ($null -eq $manifest.files) { throw '发布 manifest 缺少 files 数组。' }

        foreach ($entry in @($manifest.files)) {
            if (-not $entry.source -or [string]$entry.sha256 -notmatch '^[0-9a-fA-F]{64}$') {
                $errors.Add('发布 manifest 包含缺失 source 或非法 sha256 的条目。')
                continue
            }
            try {
                $sourcePath = Resolve-SafeChildPath -Root $SyncRoot -RelativePath ([string]$entry.source)
                if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
                    $errors.Add("公共文件尚未同步：$($entry.source)")
                    continue
                }
                $fileInfo = Get-Item -LiteralPath $sourcePath
                if ($null -ne $entry.size -and [long]$entry.size -ne $fileInfo.Length) {
                    $errors.Add("公共文件大小不一致：$($entry.source)")
                    continue
                }
                $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
                if ($actualHash -ne [string]$entry.sha256) {
                    $errors.Add("公共文件哈希不一致：$($entry.source)")
                    continue
                }
                $checkedFiles++
            }
            catch {
                $errors.Add($_.Exception.Message)
            }
        }
    }
    catch {
        $errors.Add($_.Exception.Message)
    }

    return [pscustomobject]@{
        IsValid      = ($errors.Count -eq 0)
        Errors       = @($errors)
        CheckedFiles = $checkedFiles
        Stable       = $stable
        Manifest     = $manifest
    }
}

Export-ModuleMember -Function Resolve-SafeChildPath, Read-StableVersion, Test-WpsReleasePackage
