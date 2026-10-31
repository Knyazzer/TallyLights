#define MyAppName "TallyLights"
#define MyAppVersion "0.2.0"
[Setup]
AppId={{8F3A1C2E-5B6D-4E7F-9A0B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\TallyLights.exe
SetupIconFile=app.ico
OutputDir=..\dist
OutputBaseFilename=TallyLightsSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
[Files]
Source: "..\dist\TallyLights\*"; DestDir: "{app}"; Excludes: "TallyLights-data\*,config.json,*.log"; Flags: recursesubdirs createallsubdirs ignoreversion
[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\TallyLights.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\TallyLights.exe"; WorkingDir: "{app}"; Tasks: desktopicon
[Run]
Filename: "{app}\TallyLights.exe"; Description: "Запустить TallyLights"; Flags: postinstall nowait skipifsilent
