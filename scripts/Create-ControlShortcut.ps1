$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$control = Join-Path $projectRoot 'Mugi-Service-Control.exe'
if (-not (Test-Path -LiteralPath $control)) { & (Join-Path $PSScriptRoot 'Build-Control.ps1') }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $projectRoot 'Mugi 服務控制.lnk'))
$shortcut.TargetPath = $control
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = '啟動或關閉 Mugi 本機服務，並開啟網頁設定 OpenAI API key'
$shortcut.Save()
Write-Output 'Created Mugi service-control shortcut in the project folder.'
