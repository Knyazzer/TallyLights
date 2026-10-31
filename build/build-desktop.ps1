# Multi-file development build; build-portable.ps1 embeds this runtime in one EXE.
param([string]$NodePath = (Get-Command node).Source)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopOutput = Join-Path $projectRoot 'dist\TallyLights'
New-Item -ItemType Directory -Force $desktopOutput | Out-Null
$verifiedOutput = (Resolve-Path -LiteralPath $desktopOutput).Path
foreach ($runtimeFolder in @('src', 'public', 'node_modules')) {
    $runtimePath = [IO.Path]::GetFullPath((Join-Path $verifiedOutput $runtimeFolder))
    if (-not $runtimePath.StartsWith($verifiedOutput + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime path' }
    if (Test-Path -LiteralPath $runtimePath) { Remove-Item -LiteralPath $runtimePath -Recurse -Force }
}
Copy-Item (Join-Path $projectRoot 'src') $desktopOutput -Recurse -Force
Copy-Item (Join-Path $projectRoot 'public') $desktopOutput -Recurse -Force
Copy-Item (Join-Path $projectRoot 'config.example.json') $desktopOutput -Force
Copy-Item (Join-Path $projectRoot 'package.json') $desktopOutput -Force
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $desktopOutput 'node.exe') -Force
# Copy only installed production dependency trees; no install or network needed.
Push-Location $projectRoot
try {
    $productionPaths = @(npm ls --omit=dev --all --parseable)
    if ($LASTEXITCODE -ne 0) { throw 'Production dependencies are incomplete. Run npm ci first.' }
} finally { Pop-Location }
foreach ($dependencyPath in $productionPaths) {
    if ($dependencyPath -eq $projectRoot) { continue }
    $relativePath = $dependencyPath.Substring($projectRoot.Length).TrimStart('\', '/')
    $destination = Join-Path $desktopOutput $relativePath
    New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
    if (-not (Test-Path -LiteralPath $destination)) { Copy-Item -LiteralPath $dependencyPath -Destination $destination -Recurse }
}
& (Join-Path $PSScriptRoot 'compile-desktop.ps1') -Output (Join-Path $desktopOutput 'TallyLights.exe')
Write-Host "Ready: $desktopOutput\TallyLights.exe"
