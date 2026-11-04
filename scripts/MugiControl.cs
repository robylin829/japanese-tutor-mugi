using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Management;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

public sealed class MugiControl : Form {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    readonly Label status = new Label(), note = new Label();
    readonly CheckBox power = new CheckBox();
    readonly Button open = new Button();
    readonly Timer timer = new Timer();
    Process operation;
    bool updating;
    readonly object logLock = new object();
    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MugiControl());
    }
    MugiControl() {
        Text = "Mugi 服務控制";
        ClientSize = new Size(560, 340);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Font = new Font("Microsoft JhengHei", 11);
        var title = new Label { Text = "Mugi 本機服務", Font = new Font("Microsoft JhengHei", 17, FontStyle.Bold) };
        title.SetBounds(24, 20, 510, 38);
        status.SetBounds(24, 70, 510, 30);
        power.Appearance = Appearance.Button; power.TextAlign = ContentAlignment.MiddleCenter;
        power.AccessibleName = "服務總開關"; power.SetBounds(24, 110, 230, 56);
        open.Text = "開啟服務網頁／新增 API key"; open.SetBounds(270, 110, 265, 56);
        var hint = new Label { Text = "此總開關會真正啟動或關閉伺服器。\r\n關閉服務會中止回覆，但保留設定、憑證和紀錄。\r\n關閉這個面板不會停止服務。" };
        hint.SetBounds(24, 185, 510, 75);
        note.ForeColor = Color.DarkRed; note.SetBounds(24, 265, 510, 60);
        Controls.AddRange(new Control[] { title, status, power, open, hint, note });
        power.CheckedChanged += delegate { if (!updating && operation == null) RunOperation(power.Checked); };
        open.Click += delegate { Process.Start(new ProcessStartInfo("http://127.0.0.1:3004") { UseShellExecute = true }); };
        timer.Interval = 1500; timer.Tick += delegate { RefreshState(); };
        Shown += delegate { RefreshState(); timer.Start(); };
        FormClosed += delegate { timer.Stop(); timer.Dispose(); if (operation != null) operation.Dispose(); };
    }
    bool Running() {
        try {
            var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, ".local-run", "server.json")));
            if (!String.Equals(Convert.ToString(state["root"]), root, StringComparison.OrdinalIgnoreCase)) return false;
            int pid = Convert.ToInt32(state["pid"]);
            using (var search = new ManagementObjectSearcher("SELECT Name,CommandLine,CreationDate FROM Win32_Process WHERE ProcessId=" + pid))
            using (var rows = search.Get()) {
                foreach (ManagementObject row in rows) {
                    string command = Convert.ToString(row["CommandLine"]);
                    long created = ManagementDateTimeConverter.ToDateTime(Convert.ToString(row["CreationDate"])).ToUniversalTime().Ticks;
                    return Convert.ToString(row["Name"]) == "node.exe" && created == Convert.ToInt64(state["created"]) && command.IndexOf("\"" + Convert.ToString(state["vite"]) + "\"", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
        } catch { }
        return false;
    }
    void RefreshState() {
        if (operation != null) {
            if (!operation.HasExited) { power.Enabled = false; open.Enabled = false; return; }
            note.Text = operation.ExitCode == 0 ? "" : "操作未完成；請查看專案 .local-run 資料夾的 control 日誌。";
            operation.Dispose(); operation = null;
        }
        bool running = Running();
        updating = true; power.Checked = running; updating = false;
        power.Text = running ? "總開關：開啟（按下關閉）" : "總開關：關閉（按下啟動）";
        power.Enabled = true; open.Enabled = running;
        status.Text = running ? "● 服務執行中　http://127.0.0.1:3004" : "○ 服務已關閉";
        status.ForeColor = running ? Color.DarkGreen : Color.DimGray;
    }
    void RunOperation(bool start) {
        string runDir = Path.Combine(root, ".local-run"); Directory.CreateDirectory(runDir);
        string log = Path.Combine(runDir, "control-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ".log");
        string script = Path.Combine(root, "scripts", start ? "Start-Mugi.ps1" : "Stop-Mugi.ps1");
        note.Text = start ? "正在啟動服務…" : "正在關閉服務…";
        try {
            var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            operation = new Process { StartInfo = info };
            DataReceivedEventHandler logLine = delegate(object sender, DataReceivedEventArgs data) { if (data.Data != null) { lock (logLock) File.AppendAllText(log, data.Data + Environment.NewLine); } };
            operation.OutputDataReceived += logLine; operation.ErrorDataReceived += logLine;
            operation.Start(); operation.BeginOutputReadLine(); operation.BeginErrorReadLine();
        } catch { if (operation != null) operation.Dispose(); operation = null; note.Text = "無法執行控制腳本，請檢查專案是否完整。"; }
        RefreshState();
    }
}
