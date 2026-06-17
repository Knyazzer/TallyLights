# Builds dist\TallyLightsSetup.exe — stages a self-contained payload (Node
# runtime + app + production node_modules) and compiles it with Inno Setup.
# Usage:  npm run build:installer   (or)   powershell -ExecutionPolicy Bypass -File build\build-installer.ps1
$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot          # project root
$stage = Join-Path $PSScriptRoot 'stage'
$dist  = Join-Path $root 'dist'

Write-Host '== Cleaning stage =='
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host '== Copying app files =='
Copy-Item (Join-Path $root 'src')                 (Join-Path $stage 'src')    -Recurse
Copy-Item (Join-Path $root 'public')              (Join-Path $stage 'public') -Recurse
Copy-Item (Join-Path $root 'config.example.json') $stage
Copy-Item (Join-Path $root 'package.json')        $stage
Copy-Item (Join-Path $root 'package-lock.json')   $stage
Copy-Item (Join-Path $root 'launch-hidden.vbs')   $stage
Copy-Item (Join-Path $PSScriptRoot 'app.ico')     $stage

Write-Host '== Installing production dependencies =='
Push-Location $stage
try { npm ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" } }
finally { Pop-Location }

Write-Host '== Trimming non-Windows tray binaries =='
$traybin = Join-Path $stage 'node_modules\systray2\traybin'
Remove-Item (Join-Path $traybin 'tray_darwin_release') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $traybin 'tray_linux_release')  -ErrorAction SilentlyContinue

Write-Host '== Bundling Node runtime =='
Copy-Item (Get-Command node).Source (Join-Path $stage 'node.exe')

Write-Host '== Locating Inno Setup =='
$iscc = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  'C:\Program Files\Inno Setup 6\ISCC.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $c = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($c) { $iscc = $c.Source } }
if (-not $iscc) { throw 'Inno Setup (ISCC.exe) not found. Install: winget install JRSoftware.InnoSetup' }

Write-Host '== Compiling installer =='
New-Item -ItemType Directory -Force $dist | Out-Null
& $iscc (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }

Write-Host ''
Write-Host ("== Done -> " + (Join-Path $dist 'TallyLightsSetup.exe') + ' ==')
