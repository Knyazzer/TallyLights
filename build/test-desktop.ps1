$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$generated = Join-Path $PSScriptRoot 'generated'
if (-not (Test-Path (Join-Path $generated 'Version.cs'))) { throw 'Run build:desktop or build:portable first.' }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testExe = Join-Path $generated 'ControlTests.exe'
$testLog = Join-Path $generated 'control-tests.txt'
$sources = @('Program.cs','ConsoleTheme.cs','ConsoleSelect.cs','RuntimePayload.cs','Job.cs') | ForEach-Object { Join-Path $projectRoot "desktop\$_" }
& $compiler /nologo /target:winexe /main:DesktopControlTests /platform:x64 /utf8output "/out:$testExe" "/resource:$PSScriptRoot\app.ico,TallyLights.Icon" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll @sources (Join-Path $generated 'Version.cs') (Join-Path $projectRoot 'test\desktopControls.cs')
if ($LASTEXITCODE -ne 0) { throw 'Control tests compilation failed.' }
$test = Start-Process -FilePath $testExe -ArgumentList ('"' + $testLog + '"') -WindowStyle Hidden -PassThru
if (-not $test.WaitForExit(20000)) { Stop-Process -Id $test.Id -Force; throw 'Control tests timed out.' }
if (Test-Path $testLog) { Get-Content -LiteralPath $testLog }
if ($test.ExitCode -ne 0) { throw 'Control tests failed.' }
