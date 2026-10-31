$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-desktop.ps1')
$iscc = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  'C:\Program Files\Inno Setup 6\ISCC.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($command) { $iscc = $command.Source } }
if (-not $iscc) { throw 'Inno Setup not found. Install Inno Setup 6 first.' }
$version = (Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version
& $iscc "/DMyAppVersion=$version" (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
