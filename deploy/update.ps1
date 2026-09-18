[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param([string]$MachineConfigPath = 'C:\WPS-AI\machine.env')
& (Join-Path $PSScriptRoot 'install.ps1') -MachineConfigPath $MachineConfigPath -Mode Update -WhatIf:$WhatIfPreference
exit $LASTEXITCODE
