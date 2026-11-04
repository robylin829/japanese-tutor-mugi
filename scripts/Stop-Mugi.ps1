$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateFile = Join-Path $projectRoot '.local-run\server.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No saved Mugi process.'; return }
$state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
if (-not $process) { $state.running = $false; $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile; Write-Output 'Mugi is already stopped.'; return }
if ($state.root -ne $projectRoot -or $process.CreationDate.ToUniversalTime().Ticks -ne $state.created -or $process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains('"' + $state.vite + '"')) { throw 'Saved PID no longer matches this app. No process was stopped.' }
Stop-Process -Id $state.pid -ErrorAction Stop
$state.running = $false
$state | ConvertTo-Json | Set-Content -LiteralPath $stateFile
Write-Output 'Mugi stopped. Settings, credentials and usage were retained.'
