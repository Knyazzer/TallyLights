' Launches TallyLights with NO console window — the system-tray icon is the only
' UI. Used by the installed Start-menu shortcut.
Dim fso, dir, sh
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run """" & dir & "\node.exe"" ""src\index.js""", 0, False
