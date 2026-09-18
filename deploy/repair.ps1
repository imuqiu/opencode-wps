[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param([string]$MachineConfigPath = 'C:\WPS-AI\machine.env')
& (Join-Path $PSScriptRoot 'install.ps1') -MachineConfigPath $MachineConfigPath -Mode Repair -WhatIf:$WhatIfPreference
exit $LASTEXITCODE
