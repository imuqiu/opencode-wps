Set-StrictMode -Version 2.0

function Read-KeyValueFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [string[]]$RequiredKeys = @()
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "配置文件不存在：$Path"
    }

    $values = [ordered]@{}
    $lineNumber = 0
    foreach ($rawLine in [System.IO.File]::ReadAllLines((Resolve-Path -LiteralPath $Path).Path)) {
        $lineNumber++
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#')) {
            continue
        }

        $separator = $line.IndexOf('=')
        if ($separator -lt 1) {
            throw "配置文件第 $lineNumber 行不是 KEY=VALUE：$Path"
        }

        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if ($key -notmatch '^[A-Z][A-Z0-9_]*$') {
            throw "配置文件第 $lineNumber 行包含非法键名 '$key'：$Path"
        }
        if ($values.Contains($key)) {
            throw "配置文件包含重复键 '$key'：$Path"
        }
        $values[$key] = $value
    }

    foreach ($requiredKey in $RequiredKeys) {
        if (-not $values.Contains($requiredKey) -or [string]::IsNullOrWhiteSpace([string]$values[$requiredKey])) {
            throw "配置文件缺少必要字段 '$requiredKey'：$Path"
        }
    }

    return $values
}

function Read-WpsAiMachineConfig {
    [CmdletBinding()]
    param(
        [string]$Path = 'C:\WPS-AI\machine.env',
        [switch]$AllowMissing
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ($AllowMissing) {
            return $null
        }
        throw "本机配置不存在：$Path"
    }

    $required = @(
        'CONFIG_SCHEMA', 'WPS_SYNC_ROOT', 'WPS_SYNC_ROOT_ID', 'DEVICE_NAME',
        'DEVICE_ROLE', 'RUNTIME_ROOT', 'LOCAL_PORT', 'LAUNCHER_PORT'
    )
    $config = Read-KeyValueFile -Path $Path -RequiredKeys $required

    if ($config.CONFIG_SCHEMA -ne '1') {
        throw "不支持的 CONFIG_SCHEMA：$($config.CONFIG_SCHEMA)"
    }
    if ($config.DEVICE_ROLE -notin @('primary', 'secondary')) {
        throw "DEVICE_ROLE 只能是 primary 或 secondary"
    }
    if ($config.WPS_SYNC_ROOT_ID -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw "WPS_SYNC_ROOT_ID 不是合法 UUID"
    }
    foreach ($portKey in @('LOCAL_PORT', 'LAUNCHER_PORT', 'BACKUP_PROXY_PORT')) {
        if ($config.Contains($portKey)) {
            $port = 0
            if (-not [int]::TryParse([string]$config[$portKey], [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
                throw "$portKey 必须是 1024-65535 之间的端口号"
            }
        }
    }

    return $config
}

function Write-WpsAiMachineConfig {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Values,

        [string]$Path = 'C:\WPS-AI\machine.env'
    )

    $parent = Split-Path -Parent $Path
    if (-not $parent) {
        throw "machine.env 必须有父目录"
    }
    if (-not $PSCmdlet.ShouldProcess($Path, '写入本机配置')) {
        return
    }

    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = Join-Path $parent ('.machine.env.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    try {
        $lines = foreach ($key in $Values.Keys) {
            if ([string]$key -notmatch '^[A-Z][A-Z0-9_]*$') {
                throw "非法配置键名：$key"
            }
            $value = [string]$Values[$key]
            if ($value.Contains("`r") -or $value.Contains("`n")) {
                throw "配置值不能包含换行：$key"
            }
            '{0}={1}' -f $key, $value
        }
        [System.IO.File]::WriteAllLines($temporary, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

Export-ModuleMember -Function Read-KeyValueFile, Read-WpsAiMachineConfig, Write-WpsAiMachineConfig
