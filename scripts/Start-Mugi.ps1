param([string]$TailscaleHost = '', [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runDir = Join-Path $projectRoot '.local-run'
$stateFile = Join-Path $runDir 'server.json'
$viteFile = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteFile)) { throw 'Run npm install in the project folder first.' }
if ($TailscaleHost -and ($TailscaleHost -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z0-9-]+\.ts\.net$')) { throw 'Use the exact PC hostname, such as mypc.tail123.ts.net. Wildcards are not accepted.' }
if (Get-NetTCPConnection -State Listen -LocalPort 3004 -ErrorAction SilentlyContinue) { throw 'Port 3004 is already in use. No process was stopped. Use Stop-Mugi.ps1 for this app.' }
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
if (-not $TailscaleHost -and (Test-Path (Join-Path $runDir 'tailscale-host.txt'))) { $TailscaleHost = (Get-Content -Raw (Join-Path $runDir 'tailscale-host.txt')).Trim() }
if ($TailscaleHost) { $TailscaleHost | Set-Content (Join-Path $runDir 'tailscale-host.txt') }
$savedHosts = $env:MUGI_ALLOWED_HOSTS
$savedLan = $env:MUGI_LAN
$savedDataDir = $env:MUGI_DATA_DIR
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
try {
  $env:MUGI_LAN = ''
  if (-not $env:MUGI_DATA_DIR) { $env:MUGI_DATA_DIR = Join-Path $runDir 'oauth' }
  $env:MUGI_ALLOWED_HOSTS = $TailscaleHost
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  $process = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $viteFile + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir "stdout-$stamp.log") -RedirectStandardError (Join-Path $runDir "stderr-$stamp.log") -PassThru
  $created = (Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)").CreationDate.ToUniversalTime().Ticks
  @{ pid = $process.Id; created = $created; vite = $viteFile; root = $projectRoot; running = $true } | ConvertTo-Json | Set-Content -LiteralPath $stateFile
} finally { $env:MUGI_ALLOWED_HOSTS = $savedHosts; $env:MUGI_LAN = $savedLan; $env:MUGI_DATA_DIR = $savedDataDir }
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  try { $r = Invoke-WebRequest 'http://127.0.0.1:3004/api/settings/openai-api' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
  if ($process.HasExited) { break }
}
if (-not $ready) { throw "App did not become ready. Check logs in $runDir and run Stop-Mugi.ps1 before retrying." }
Write-Output 'Mugi is ready: http://127.0.0.1:3004 (loopback only)'
if ($TailscaleHost) { Write-Output "Phone hostname configured: $TailscaleHost. Enable Tailscale Serve separately." }
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:3004' }
