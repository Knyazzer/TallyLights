param([Parameter(Mandatory=$true)][string]$Output, [string]$Payload)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable major.minor.patch version is required.' }
$generated = Join-Path $PSScriptRoot 'generated'
New-Item -ItemType Directory -Force $generated | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw 'Windows .NET Framework 4.x compiler was not found.' }
$icon = Join-Path $PSScriptRoot 'app.ico'
if (-not ('IconBuilder' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'IconBuilder.cs') -ReferencedAssemblies System.Drawing }
[IconBuilder]::Build(@($icon, (Join-Path $generated 'logo.png')))
$versionSource = Join-Path $generated 'Version.cs'
@"
using System.Reflection;
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
[assembly: AssemblyInformationalVersion("$version")]
internal static class AppInfo { public const string Version = "$version"; }
"@ | Set-Content -LiteralPath $versionSource -Encoding UTF8
$arguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output',
    "/out:$Output", "/win32icon:$icon", "/resource:$icon,TallyLights.Icon", "/resource:$(Join-Path $generated 'logo.png'),TallyLights.Logo",
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
    (Join-Path $projectRoot 'desktop\Program.cs'), (Join-Path $projectRoot 'desktop\Job.cs'),
    (Join-Path $projectRoot 'desktop\ConsoleTheme.cs'), (Join-Path $projectRoot 'desktop\RuntimePayload.cs'), $versionSource)
if ($Payload) { $arguments += "/resource:$Payload,TallyLights.Payload" }
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
