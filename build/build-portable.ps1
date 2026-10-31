$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-Sha256([string]$Path) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    $inputStream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($hasher.ComputeHash($inputStream))).Replace('-', '').ToLowerInvariant() }
    finally { $inputStream.Dispose(); $hasher.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$runtime = Get-Content (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
$cache = Join-Path $projectRoot '.portable-build'
New-Item -ItemType Directory -Force $cache | Out-Null
$archiveName = "node-v$($runtime.version)-$($runtime.platform)"
$archive = Join-Path $cache "$archiveName.zip"
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest "https://nodejs.org/dist/v$($runtime.version)/$archiveName.zip" -OutFile $archive -UseBasicParsing
}
if ((Get-Sha256 $archive) -ne $runtime.sha256) {
    throw 'Node archive checksum mismatch. Remove the cached archive and retry.'
}
$runtimeHome = Join-Path $cache $archiveName
if (-not (Test-Path -LiteralPath (Join-Path $runtimeHome 'node.exe'))) { [IO.Compression.ZipFile]::ExtractToDirectory($archive, $cache) }
$nodePath = Join-Path $runtimeHome 'node.exe'
$identity = & $nodePath -p "process.version + ' ' + process.platform + ' ' + process.arch"
if ($identity -ne "v$($runtime.version) win32 x64") { throw "Unexpected runtime: $identity" }
& (Join-Path $PSScriptRoot 'build-desktop.ps1') -NodePath $nodePath
$staged = Join-Path $projectRoot 'dist\TallyLights'
Copy-Item -LiteralPath (Join-Path $runtimeHome 'LICENSE') -Destination (Join-Path $staged 'NODE-LICENSE.txt') -Force
$payload = Join-Path $cache 'runtime.zip'
$stream = [IO.File]::Open($payload, [IO.FileMode]::Create)
try {
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        # Explicit release allowlist: no local configs, logs, fixtures, tests or EXEs.
        $files = @('node.exe', 'package.json', 'config.example.json', 'NODE-LICENSE.txt') | ForEach-Object { Get-Item -LiteralPath (Join-Path $staged $_) }
        foreach ($folder in @('src', 'public', 'node_modules')) { $files += Get-ChildItem -LiteralPath (Join-Path $staged $folder) -File -Recurse }
        foreach ($file in $files) {
            $entryName = $file.FullName.Substring($staged.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$output = Join-Path $projectRoot 'dist\portable'
New-Item -ItemType Directory -Force $output | Out-Null
$exe = Join-Path $output "TallyLights_V$version.exe"
& (Join-Path $PSScriptRoot 'compile-desktop.ps1') -Output $exe -Payload $payload
$hash = Get-Sha256 $exe
"$hash  $([IO.Path]::GetFileName($exe))" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII
Write-Host "Portable release: $exe ($([Math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)"
