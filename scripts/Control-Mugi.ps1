$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$control = Join-Path $projectRoot 'Mugi-Service-Control.exe'
if (-not (Test-Path -LiteralPath $control)) { & (Join-Path $PSScriptRoot 'Build-Control.ps1') }
Start-Process -FilePath $control -WorkingDirectory $projectRoot
