Set-StrictMode -Version 2.0

function Write-DeployLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('DEBUG', 'INFO', 'WARN', 'ERROR')]
        [string]$Level,

        [Parameter(Mandatory = $true)]
        [string]$Message,

        [string]$LogPath
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    $safeMessage = $Message `
        -replace '(?i)(api[_-]?key|token|cookie|secret|password)\s*[=:]\s*[^\s;]+', '$1=<redacted>'
    $line = '[{0}] [{1}] {2}' -f $timestamp, $Level, $safeMessage

    if ($Level -eq 'ERROR') {
        Write-Host $line -ForegroundColor Red
    }
    elseif ($Level -eq 'WARN') {
        Write-Host $line -ForegroundColor Yellow
    }
    elseif ($Level -ne 'DEBUG' -or $VerbosePreference -eq 'Continue') {
        Write-Host $line
    }

    if ($LogPath) {
        $parent = Split-Path -Parent $LogPath
        if ($parent -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    }
}

Export-ModuleMember -Function Write-DeployLog
