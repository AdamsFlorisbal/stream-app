' Abre o Deck Control na bandeja do sistema, sem nenhuma janela de console.
' Equivalente a iniciar.bat, mas some no icone perto do relogio em vez de
' ocupar a tela com um terminal.
Dim fso, root, script, shell
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = root & "\tools\tray.ps1"

Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
