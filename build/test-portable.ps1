param([string]$Executable)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Executable) { $Executable = Join-Path $projectRoot "dist\portable\TallyLights_V$version.exe" }
$testHome = Join-Path $projectRoot ('.portable-build\smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $testHome | Out-Null
$exe = Join-Path $testHome ([IO.Path]::GetFileName($Executable))
Copy-Item -LiteralPath $Executable -Destination $exe
$data = Join-Path $testHome 'TallyLights-data'
New-Item -ItemType Directory -Force $data | Out-Null
$initial = Get-Content (Join-Path $projectRoot 'config.example.json') -Raw | ConvertFrom-Json
$initial.atem.enabled = $false
$initial.comPort = 'COM99999' # Never open a real device in a packaging test.
$initial | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $data 'config.json') -Encoding UTF8
$log = Join-Path $data 'server.log'
$script:application = $null
$script:runtimeRoot = $null
function Start-TestApp {
    $previousReady = if (Test-Path $log) { @(Select-String -LiteralPath $log -Pattern '^TALLY_READY ').Count } else { 0 }
    $script:application = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($script:application.HasExited) { throw "Application exited: $($script:application.ExitCode). See $log" }
        if (Test-Path $log) {
            $lines = @(Select-String -LiteralPath $log -Pattern '^TALLY_READY ')
            if ($lines.Count -gt $previousReady) {
                $port = ($lines[-1].Line.Substring(12) | ConvertFrom-Json).port
                $script:runtimeRoot = (Select-String -LiteralPath $log -Pattern '^TALLY_RUNTIME ' | Select-Object -Last 1).Line.Substring(14)
                return "http://127.0.0.1:$port"
            }
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Application readiness timed out. See $log"
}
function Stop-TestApp {
    Start-Process -FilePath $exe -ArgumentList '--exit' -WindowStyle Hidden -Wait
    if (-not $script:application.WaitForExit(15000)) { throw 'Native application did not stop gracefully.' }
    if ($script:application.ExitCode -ne 0) { throw "Native exit code: $($script:application.ExitCode)" }
    if (Test-Path -LiteralPath $script:runtimeRoot) { throw "Runtime was not cleaned: $script:runtimeRoot" }
}
function Api([string]$Route) { Invoke-RestMethod "$script:baseUrl$Route" -TimeoutSec 10 }
try {
    $script:baseUrl = Start-TestApp
    if ((Api '/status').version -ne $version) { throw 'Embedded server version mismatch.' }
    # A second launch must reveal the existing native window and exit, without a second server.
    $second = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    if (-not $second.WaitForExit(10000) -or $second.ExitCode -ne 0 -or $script:application.HasExited) { throw 'Single instance check failed.' }
    $titleDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $script:application.Refresh()
        if ($script:application.MainWindowTitle -eq "Tally Lights v$version") { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $titleDeadline)
    if ($script:application.MainWindowTitle -ne "Tally Lights v$version") { throw "Native window version mismatch: $($script:application.MainWindowTitle)" }
    Api '/api/ports' | Out-Null # Exercises the real native SerialPort.list binding in the extracted runtime.
    $expected = @{
        comPort = 'COM55555'; baudRate = 115200; onAtemDisconnect = 'hold'
        atem = @{enabled = $false; ip = '192.0.2.10'; me = 2}
        lamps = @(1..6 | ForEach-Object { @{id = $_; atemInput = if ($_ -eq 6) {0} else {10 + $_}} })
    }
    Invoke-RestMethod "$script:baseUrl/api/config" -Method Patch -ContentType 'application/json' -Body ($expected | ConvertTo-Json -Depth 10) | Out-Null
    Stop-TestApp
    $saved = Get-Content (Join-Path $data 'config.json') -Raw | ConvertFrom-Json
    if ($saved.lamps[0].atemInput -ne 11) { throw 'Mapping did not reach disk.' }
    $script:baseUrl = Start-TestApp
    $restored = Api '/api/config'
    foreach ($field in @('comPort', 'baudRate', 'onAtemDisconnect')) {
        if ($restored.$field -ne $expected.$field) { throw "Setting not restored: $field" }
    }
    foreach ($field in @('enabled', 'ip', 'me')) {
        if ($restored.atem.$field -ne $expected.atem.$field) { throw "ATEM setting not restored: $field" }
    }
    for ($i = 0; $i -lt 6; $i++) {
        if ($restored.lamps[$i].id -ne $expected.lamps[$i].id -or $restored.lamps[$i].atemInput -ne $expected.lamps[$i].atemInput) { throw 'Mapping not restored.' }
    }
    $runtimeNode = Join-Path $script:runtimeRoot 'node.exe'
    $actualRuntime = & $runtimeNode -p "process.version + ' ' + process.arch"
    $pinned = Get-Content (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
    if ($actualRuntime -ne "v$($pinned.version) x64") { throw 'Portable runtime mismatch.' }
    Stop-TestApp
    # Quit during extraction as well: no server may appear after its host exits.
    $tempParent = Join-Path ([IO.Path]::GetTempPath()) 'TallyLights-runtime'
    $known = @(Get-ChildItem -LiteralPath $tempParent -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $script:application = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $newRuntime = $null
    do {
        $newRuntime = Get-ChildItem -LiteralPath $tempParent -Directory -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin $known } | Select-Object -First 1
        if ($newRuntime) { break }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $startupDeadline)
    if (-not $newRuntime) { throw 'No extracted runtime appeared for the startup shutdown check.' }
    $script:runtimeRoot = $newRuntime.FullName
    Stop-TestApp
    if (@(Get-ChildItem -LiteralPath $testHome).Count -ne 2) { throw 'Portable host wrote unexpected files beside the EXE.' }
    Write-Host "PASS: portable v$version; native window, single instance, serial binding, mapping/settings restart persistence, normal/startup exit and runtime cleanup."
    Write-Host "Isolated test data: $testHome"
} finally {
    if ($script:application -and -not $script:application.HasExited) {
        Start-Process -FilePath $exe -ArgumentList '--exit' -WindowStyle Hidden -Wait
        if (-not $script:application.WaitForExit(15000)) { Stop-Process -Id $script:application.Id -Force }
    }
}
