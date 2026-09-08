// Deck Control - launcher nativo.
//
// So' existe para abrir tools\tray.ps1 sem nenhuma janela de console --
// equivalente a iniciar-bandeja.vbs, mas como um .exe de verdade (icone
// proprio, nome no Explorer, sem depender do wscript). A logica de verdade
// (bandeja, menu, ciclo de vida do servidor) mora inteira em tray.ps1; isto
// aqui e' so' a porta de entrada.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Deck Control")]
[assembly: AssemblyProduct("Deck Control")]
[assembly: AssemblyDescription("Abre o Deck Control na bandeja do sistema")]
[assembly: AssemblyCompany("Deck Control")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Launcher
{
    [STAThread]
    private static void Main()
    {
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(exeDir, "tools", "tray.ps1");

        if (!File.Exists(script))
        {
            MessageBox.Show(
                "Nao encontrei tools\\tray.ps1 ao lado deste executavel.\n" +
                "Mova-o de volta para a raiz do projeto Deck Control.",
                "Deck Control", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"",
            WorkingDirectory = exeDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        try
        {
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Falha ao iniciar o Deck Control: " + ex.Message,
                "Deck Control", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
