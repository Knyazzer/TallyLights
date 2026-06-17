; Inno Setup script for TallyLights — builds a per-user installer (no admin
; prompt) that registers the app in Start menu / search / "Installed apps"
; with an uninstaller. Payload is staged into build\stage by build-installer.ps1.

#define MyAppName "TallyLights"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "TallyLights"

[Setup]
AppId={{8F3A1C2E-5B6D-4E7F-9A0B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install: no admin elevation, still shows in Start menu and Apps list.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\app.ico
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
; Everything staged by build-installer.ps1 (node.exe + app + prod node_modules).
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; Launch via the hidden .vbs so there is no console window — the tray icon is the UI.
Name: "{group}\{#MyAppName}"; Filename: "{app}\launch-hidden.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Comment: "Запустить TallyLights"
Name: "{group}\Удалить {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\launch-hidden.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\launch-hidden.vbs"; WorkingDir: "{app}"; Description: "Запустить TallyLights сейчас"; Flags: postinstall nowait skipifsilent shellexec
