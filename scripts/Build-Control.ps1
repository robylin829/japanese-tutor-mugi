$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler was not found.' }
& $compiler /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll ("/out:" + (Join-Path $projectRoot 'Mugi-Service-Control.exe')) (Join-Path $PSScriptRoot 'MugiControl.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not build the service control panel. Close it before rebuilding.' }
Write-Output 'Built Mugi-Service-Control.exe'
