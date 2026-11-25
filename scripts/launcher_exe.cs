using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace ChipScreenerLauncher
{
    internal static class Program
    {
        private static string QuoteArg(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            if (arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        }

        private static string FindExecutable(string name)
        {
            string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string direct = Path.Combine(winDir, name);
            if (File.Exists(direct)) return direct;

            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), name);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string launcherScript = Path.Combine(root, "scripts", "launcher.py");

            if (!File.Exists(launcherScript))
            {
                MessageBox.Show(
                    "找不到啟動腳本：\n" + launcherScript + "\n\n請確認 ChipScreener.exe 位於專案根目錄。",
                    "台股籌碼雷達無法啟動",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            string pythonExe =
                FindExecutable("pyw.exe") ??
                FindExecutable("pythonw.exe") ??
                FindExecutable("py.exe") ??
                FindExecutable("python.exe");

            if (pythonExe == null)
            {
                MessageBox.Show(
                    "找不到 Python 執行環境，請先安裝 Python 3.10 以上版本。",
                    "台股籌碼雷達無法啟動",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            var argBuilder = new StringBuilder();
            argBuilder.Append("-B -X utf8 ");
            argBuilder.Append(QuoteArg(launcherScript));
            foreach (string arg in args)
            {
                argBuilder.Append(' ');
                argBuilder.Append(QuoteArg(arg));
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = pythonExe,
                    Arguments = argBuilder.ToString(),
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                psi.EnvironmentVariables["PYTHONUTF8"] = "1";
                Process.Start(psi);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "啟動失敗：\n" + ex.Message,
                    "台股籌碼雷達無法啟動",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }
        }
    }
}
