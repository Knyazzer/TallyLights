using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Tally Lights")]
[assembly: AssemblyProduct("Tally Lights")]

internal static class Program {
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string home = AppDomain.CurrentDomain.BaseDirectory;
        string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(home.ToLowerInvariant()))).Replace("-", "");
        if (Array.IndexOf(args, "--exit") >= 0) {
            try { using (var signal = EventWaitHandle.OpenExisting("Local\\TallyLightsStop-" + hash)) signal.Set(); } catch (WaitHandleCannotBeOpenedException) {}
            return 0;
        }
        bool owned;
        using (var mutex = new Mutex(true, "Local\\TallyLights-" + hash, out owned)) {
            if (!owned) {
                try { using (var signal = EventWaitHandle.OpenExisting("Local\\TallyLightsShow-" + hash)) signal.Set(); } catch {}
                return 0;
            }
            try {
                using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TallyLightsShow-" + hash))
                using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TallyLightsStop-" + hash))
                using (var form = new MainForm(home)) {
                    var wait = ThreadPool.RegisterWaitForSingleObject(show, delegate { form.Reveal(); }, null, -1, false);
                    var stopWait = ThreadPool.RegisterWaitForSingleObject(stop, delegate { form.RequestQuit(); }, null, -1, false);
                    try { Application.Run(form); } finally { wait.Unregister(null); stopWait.Unregister(null); }
                }
                return 0;
            } catch (Exception e) {
                MessageBox.Show(e.Message, "TallyLights", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            } finally { mutex.ReleaseMutex(); }
        }
    }
}
internal sealed class Choice {
    public string Id, Name;
    public Choice(string id, string name) { Id = id; Name = name; }
    public override string ToString() { return Name; }
}
internal sealed class MainForm : Form {
    protected override CreateParams CreateParams {
        get { var parameters = base.CreateParams; parameters.ExStyle |= 0x02000000; return parameters; }
    }
    protected override void OnResizeEnd(EventArgs e) { base.OnResizeEnd(e); Invalidate(true); Update(); }
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        try { int dark = 1; DwmSetWindowAttribute(Handle, 20, ref dark, 4); } catch (DllNotFoundException) { }
    }
    readonly string home;
    readonly Color ink = ConsoleTheme.Text, muted = ConsoleTheme.Muted;
    readonly Color green = ConsoleTheme.Preview, red = ConsoleTheme.Program;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly NotifyIcon tray;
    readonly ToolTip operationTip = new ToolTip { AutoPopDelay = 8000, InitialDelay = 100, ReshowDelay = 100 };
    readonly HashSet<Control> pending = new HashSet<Control>();
    readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer();
    readonly Label atemStatus, serialStatus, notice, atemBank;
    readonly TallyKey[] programKeys = new TallyKey[6], previewKeys = new TallyKey[6];
    readonly ConsoleSelect[] mappings = new ConsoleSelect[6];
    readonly List<Button> testButtons = new List<Button>();
    readonly ConsoleSelect ports, baud, disconnect, meSelector;
    readonly TextBox ip;
    readonly ListBox devices;
    readonly Panel[] pages = new Panel[3];
    readonly ConsoleButton[] nav = new ConsoleButton[3];
    Dictionary<string, object> config;
    object[] inputs = new object[0];
    string inputSignature = "", url;
    Process server;
    ServerJob job;
    RuntimePayload runtime;
    Task bootTask;
    bool quitting, busyPoll, loaded, meAvailable;
    readonly TaskCompletionSource<int> ready = new TaskCompletionSource<int>();

    static Dictionary<string, object> Obj(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    static object Get(object value, string key) { object result; return Obj(value).TryGetValue(key, out result) ? result : null; }
    static string TextOf(object value) { return value == null ? "" : Convert.ToString(value); }
    static bool Flag(object value) { return value is bool && (bool)value; }
    static object[] Items(object value) { return value as object[] ?? new object[0]; }
    Label LabelOf(string text, int size, bool bold) {
        return new Label { Text = text, AutoSize = false, Dock = DockStyle.Fill, ForeColor = ink, BackColor = Color.Transparent,
            Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular), TextAlign = ContentAlignment.MiddleLeft };
    }
    ConsoleButton ButtonOf(string text) {
        return new ConsoleButton { Text = text, Width = 145, Height = 30, Margin = new Padding(0, 3, 8, 3) };
    }
    FlowLayoutPanel Row(params Control[] children) {
        var row = new ConsoleFlow { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, Margin = new Padding(0), Padding = new Padding(0, 2, 0, 2), BackColor = Color.Transparent };
        row.Controls.AddRange(children); return row;
    }
    TableLayoutPanel Stack(Control parent) {
        var stack = new ConsoleTable { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, Padding = new Padding(16, 10, 16, 10), BackColor = Color.Transparent };
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        parent.Controls.Add(stack); return stack;
    }
    void Add(TableLayoutPanel stack, Control control, int height) {
        int n = stack.RowCount++; stack.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        control.Dock = DockStyle.Fill; stack.Controls.Add(control, 0, n);
    }
    Label Hint(string text) { var label = LabelOf(text, 9, false); label.ForeColor = muted; return label; }
    Label SectionLabel(string text) {
        var label = LabelOf(text, 10, true); label.Padding = new Padding(0); return label;
    }
    TableLayoutPanel SixColumns() {
        var row = new ConsoleTable { Dock = DockStyle.Fill, ColumnCount = 6, RowCount = 1, Margin = new Padding(0) };
        for (int n = 0; n < 6; n++) row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / 6));
        return row;
    }
    public MainForm(string home) {
        this.home = home;
        Text = "Tally Lights v" + AppInfo.Version;
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        SuspendLayout();
        Font = new Font("Segoe UI", 9);
        BackColor = ConsoleTheme.Workspace; ForeColor = ink;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1220, 920); MinimumSize = new Size(1140, 860);
        StartPosition = FormStartPosition.CenterScreen;
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("TallyLights.Icon")) Icon = new Icon(stream);
        var shell = new ConsoleTable { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, Padding = new Padding(0), Margin = new Padding(0) };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 50)); shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
        Controls.Add(shell);
        var heading = new ConsoleSurface { Dock = DockStyle.Fill, Gradient = true, Margin = new Padding(0), Padding = new Padding(19, 0, 19, 0) };
        var title = LabelOf("Tally Lights", 17, false);
        var subtitle = Hint("BLACKMAGIC ATEM  /  AVMATRIX"); subtitle.Dock = DockStyle.Right; subtitle.Width = 257; subtitle.TextAlign = ContentAlignment.MiddleRight;
        heading.Controls.Add(title); heading.Controls.Add(subtitle); shell.Controls.Add(heading, 0, 0);
        var workspace = new ConsoleTable { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(10), Margin = new Padding(0) };
        workspace.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); workspace.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 272));
        shell.Controls.Add(workspace, 0, 1);
        var main = new ConsoleTable { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, Margin = new Padding(0, 0, 9, 0) };
        main.RowStyles.Add(new RowStyle(SizeType.Absolute, 238)); main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); workspace.Controls.Add(main, 0, 0);
        var monitor = new ConsoleSurface { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8), Padding = new Padding(15, 7, 15, 9) };
        var buses = Stack(monitor); buses.Padding = new Padding(0);
        var busTitle = Hint("TALLY MONITOR"); busTitle.ForeColor = ConsoleTheme.Amber; Add(buses, busTitle, 25);
        Add(buses, Hint("Program"), 24); var programRow = SixColumns(); Add(buses, programRow, 62);
        Add(buses, Hint("Preview"), 29); var previewRow = SixColumns(); Add(buses, previewRow, 62);
        for (int n = 0; n < 6; n++) {
            programKeys[n] = new TallyKey { Text = "TALLY " + (n + 1), Dock = DockStyle.Fill, Margin = new Padding(0, 0, 8, 0), Signal = ConsoleTheme.Program, BackColor = ConsoleTheme.Panel };
            previewKeys[n] = new TallyKey { Text = "TALLY " + (n + 1), Dock = DockStyle.Fill, Margin = new Padding(0, 0, 8, 0), Signal = ConsoleTheme.Preview, BackColor = ConsoleTheme.Panel };
            programKeys[n].UpdateState("Вход " + (n + 1), false, false); previewKeys[n].UpdateState("Вход " + (n + 1), false, false);
            programRow.Controls.Add(programKeys[n], n, 0); previewRow.Controls.Add(previewKeys[n], n, 0);
        }
        main.Controls.Add(monitor, 0, 0);
        // Keep one stationary frame outside the scrolling pages. A page's child
        // controls must never paint over its border, including after a resize.
        var content = new ConsoleSurface { Dock = DockStyle.Fill, Margin = new Padding(0), Padding = new Padding(1) }; main.Controls.Add(content, 0, 1);
        for (int n = 0; n < 3; n++) {
            pages[n] = new ConsolePanel { Dock = DockStyle.Fill, AutoScroll = true, Margin = new Padding(0) };
            content.Controls.Add(pages[n]);
        }

        // The right-side palette stays visible when changing workspaces.
        var palette = new ConsoleSurface { Dock = DockStyle.Fill, Margin = new Padding(0) }; workspace.Controls.Add(palette, 1, 0);
        var side = Stack(palette); side.Padding = new Padding(12, 8, 12, 12);
        var paletteTab = LabelOf("Подключения", 9, true); paletteTab.ForeColor = ConsoleTheme.Amber; paletteTab.TextAlign = ContentAlignment.MiddleCenter;
        Add(side, paletteTab, 29);
        Add(side, SectionLabel("Blackmagic ATEM"), 29);
        atemStatus = LabelOf("●  Поиск пульта…", 10, false); Add(side, atemStatus, 66);
        atemBank = Hint(""); Add(side, atemBank, 28);
        Add(side, SectionLabel("AVMATRIX Tally"), 29);
        serialStatus = LabelOf("●  Поиск устройства…", 10, false); Add(side, serialStatus, 66);
        Add(side, Hint("USB / COM · Firmata"), 28);
        notice = Hint(""); notice.ForeColor = red; Add(side, notice, 110);

        var settings = new ConsoleTable { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0) };
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var left = new ConsolePanel { Dock = DockStyle.Fill, AutoSize = true }; var right = new ConsolePanel { Dock = DockStyle.Fill, AutoSize = true };
        settings.Controls.Add(left, 0, 0); settings.Controls.Add(right, 1, 0); pages[0].Controls.Add(settings);
        var a = Stack(left);
        Add(a, SectionLabel("Подключение к ATEM"), 29);
        var scanInfo = Hint("Найдите пульт в сети или укажите IP."); Add(a, scanInfo, 38);
        var scan = ButtonOf("Сканировать сеть");
        scan.Click += async delegate { await Action(scan, async () => {
            var found = Items(await Api("/api/atem/scan"));
            devices.Items.Clear();
            foreach (var item in found) devices.Items.Add(new Choice(TextOf(Get(item, "ip")), (TextOf(Get(item, "name")) == "" ? "ATEM" : TextOf(Get(item, "name"))) + " · " + TextOf(Get(item, "ip"))));
            scanInfo.Text = found.Length == 0 ? "Пульты не найдены. Введите IP вручную." : "Выберите пульт и нажмите «Подключить».";
            if (found.Length > 0) devices.SelectedIndex = 0;
        }, "Сканирование…"); };
        Add(a, Row(scan), 40);
        devices = new ListBox { IntegralHeight = false, BorderStyle = BorderStyle.FixedSingle, BackColor = ConsoleTheme.Well, ForeColor = ink };
        devices.SelectedIndexChanged += delegate { var selected = devices.SelectedItem as Choice; if (selected != null) ip.Text = selected.Id; };
        Add(a, devices, 90);
        Add(a, Hint("IP-адрес пульта"), 29);
        ip = new TextBox { Dock = DockStyle.Fill, BackColor = ConsoleTheme.Well, ForeColor = ink, BorderStyle = BorderStyle.None };
        var ipWell = new ConsoleSurface { Width = 233, Height = 28, Padding = new Padding(7, 6, 7, 3), BackColor = ConsoleTheme.Well };
        ipWell.Controls.Add(ip);
        var connect = ButtonOf("Подключить"); connect.Width = 125;
        connect.Click += async delegate { await Action(connect, async () => { await Save(new { atem = new { enabled = true, ip = ip.Text.Trim() } }); }); };
        Add(a, Row(ipWell, connect), 40);
        Add(a, Hint("Пустой IP включает автопоиск."), 30);
        Add(a, Hint("M/E для Tally"), 26);
        meSelector = new ConsoleSelect { DropDownStyle = ComboBoxStyle.DropDownList, Width = 135, AccessibleName = "M/E для Tally", Enabled = false };
        meSelector.Items.Add(new Choice("1", "M/E 1")); meSelector.SelectedItem = meSelector.Items[0];
        meSelector.SelectionChangeCommitted += async delegate { await Action(meSelector, async () => {
            await Save(new { atem = new { me = int.Parse(((Choice)meSelector.SelectedItem).Id) } });
        }); };
        Add(a, Row(meSelector), 36);
        var s = Stack(right);
        Add(s, SectionLabel("Подключение к Tally"), 29);
        Add(s, Hint("USB переподключается автоматически."), 38);
        ports = new ConsoleSelect { DropDownStyle = ComboBoxStyle.DropDownList, Width = 260, DropDownWidth = 340 };
        var refresh = ButtonOf("Обновить порты");
        refresh.Click += async delegate { await Action(refresh, LoadPorts); };
        Add(s, Row(ports), 36); Add(s, Row(refresh), 40);
        baud = new ConsoleSelect { Width = 140, DropDownStyle = ComboBoxStyle.DropDown };
        baud.Items.AddRange(new object[] { "9600", "19200", "38400", "57600", "115200" });
        Add(s, Hint("Скорость COM-порта, бод"), 26); Add(s, Row(baud), 38);
        var saveSerial = ButtonOf("Применить");
        saveSerial.Click += async delegate { await Action(saveSerial, async () => {
            int rate; if (!int.TryParse(baud.Text, out rate)) throw new Exception("Укажите скорость числом.");
            var selected = ports.SelectedItem as Choice; if (selected == null) throw new Exception("Выберите COM-порт.");
            await Save(new { comPort = selected.Id, baudRate = rate });
        }); };
        Add(s, Row(saveSerial), 40);
        Add(s, Hint("Порт открыт — команды отправляются. Получение сигнала боксом проверьте во вкладке «Тесты»."), 54);
        disconnect = new ConsoleSelect { DropDownStyle = ComboBoxStyle.DropDownList, Width = 304 };
        disconnect.Items.Add(new Choice("clear", "Clear · погасить лампы"));
        disconnect.Items.Add(new Choice("hold", "Hold · оставить последнее состояние"));
        disconnect.SelectionChangeCommitted += async delegate { await Action(disconnect, async () => {
            await Save(new { onAtemDisconnect = ((Choice)disconnect.SelectedItem).Id });
        }); };
        Add(s, Hint("При потере ATEM"), 26); Add(s, Row(disconnect), 36);

        var map = Stack(pages[1]);
        var mapHost = new ConsolePanel { Dock = DockStyle.Fill };
        var mapGrid = new ConsoleTable { ColumnCount = 1, RowCount = 6, Width = 300, Height = 288, Anchor = AnchorStyles.Top };
        mapGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (int row = 0; row < 6; row++) mapGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        mapHost.Controls.Add(mapGrid);
        mapHost.SizeChanged += delegate { mapGrid.Left = Math.Max(0, (mapHost.ClientSize.Width - mapGrid.Width) / 2); };
        Add(map, SectionLabel("Назначение входов ATEM"), 29);
        Add(map, Hint("Маппинг сохраняется и применяется при выборе входа."), 38);
        for (int n = 0; n < 6; n++) {
            int index = n;
            var label = LabelOf("Tally " + (n + 1), 10, true); label.Width = 64; label.Dock = DockStyle.None; label.Height = 30;
            mappings[n] = new ConsoleSelect { DropDownStyle = ComboBoxStyle.DropDownList, Width = 210, DropDownWidth = 300, AccessibleName = "Вход для Tally " + (n + 1) };
            mappings[n].SelectionChangeCommitted += async delegate { await Action(mappings[index], async () => {
                var updated = new List<object>();
                foreach (var item in Items(Get(config, "lamps"))) {
                    int id = Convert.ToInt32(Get(item, "id"));
                    updated.Add(new { id = id, atemInput = id == index + 1 ? int.Parse(((Choice)mappings[index].SelectedItem).Id) : Convert.ToInt32(Get(item, "atemInput")) });
                }
                await Save(new { lamps = updated });
            }); };
            mapGrid.Controls.Add(Row(label, mappings[n]), 0, n);
        }
        Add(map, mapHost, 300);
        var tests = Stack(pages[2]);
        Add(tests, SectionLabel("Тестовые сигналы"), 29);
        Add(tests, Hint("Program"), 27);
        var testProgram = SixColumns(); Add(tests, testProgram, 74);
        Add(tests, Hint("Preview"), 31);
        var testPreview = SixColumns(); Add(tests, testPreview, 74);
        for (int n = 0; n < 6; n++) {
            int id = n + 1;
            var program = ButtonOf("TALLY " + id); program.Key = true; program.SignalColor = "program"; program.LampId = id; program.Dock = DockStyle.Fill;
            program.AccessibleName = "Тест Program — Tally " + id;
            var preview = ButtonOf("TALLY " + id); preview.Key = true; preview.SignalColor = "preview"; preview.LampId = id; preview.Dock = DockStyle.Fill;
            preview.AccessibleName = "Тест Preview — Tally " + id;
            program.Click += async delegate { await Action(program, async () => { await Api("/api/test/lamp/" + id + "?color=program", new {}, "POST"); }); };
            preview.Click += async delegate { await Action(preview, async () => { await Api("/api/test/lamp/" + id + "?color=preview", new {}, "POST"); }); };
            testButtons.Add(program); testButtons.Add(preview); testProgram.Controls.Add(program, n, 0); testPreview.Controls.Add(preview, n, 0);
        }

        var footer = new ConsoleSurface { Dock = DockStyle.Fill, Gradient = true, Margin = new Padding(0) };
        var footerLayout = new ConsoleTable { Dock = DockStyle.Fill, ColumnCount = 3, Margin = new Padding(0) };
        footerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        footerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 354)); footerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var navigation = new ConsoleFlow { Dock = DockStyle.Fill, Margin = new Padding(0), WrapContents = false };
        string[] titles = { "Настройки", "Маппинг", "Тесты" };
        for (int n = 0; n < 3; n++) {
            int index = n;
            nav[n] = ButtonOf(titles[n]); nav[n].Navigation = true; nav[n].Glyph = n; nav[n].Width = 118; nav[n].Height = 60; nav[n].Margin = new Padding(0);
            nav[n].Click += delegate { SelectPage(index); }; navigation.Controls.Add(nav[n]);
        }
        footerLayout.Controls.Add(navigation, 1, 0);
        footer.Controls.Add(footerLayout); shell.Controls.Add(footer, 0, 2);
        tray = new NotifyIcon { Icon = Icon, Text = Text, Visible = true };
        var menu = new ContextMenuStrip { BackColor = ConsoleTheme.Panel, ForeColor = ink };
        menu.Items.Add("Открыть Tally Lights", null, delegate { Reveal(); });
        menu.Items.Add("Завершить процесс", null, async delegate { await Quit(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { Reveal(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!quitting) { e.Cancel = true; Hide(); } };
        Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); };
        poll.Interval = 750; poll.Tick += async delegate { await Poll(); };
        Shown += delegate { bootTask = Boot(); };
        SelectPage(1);
        ResumeLayout(true);
    }
    void SelectPage(int index) {
        for (int n = 0; n < 3; n++) {
            pages[n].Visible = n == index; nav[n].Active = n == index; nav[n].Invalidate();
        }
    }
    string SourceName(int input) {
        if (input == 0) return "Не назначено";
        foreach (var item in inputs) if (Convert.ToInt32(Get(item, "id")) == input) return TextOf(Get(item, "name"));
        return "Вход " + input;
    }
    public void Reveal() {
        if (IsDisposed || !IsHandleCreated) return;
        if (InvokeRequired) { BeginInvoke((Action)Reveal); return; }
        Show(); WindowState = FormWindowState.Normal; Activate();
    }
    public void RequestQuit() {
        if (!IsDisposed && IsHandleCreated) BeginInvoke((Action)(async delegate { await Quit(); }));
    }
    async Task Action(Control control, Func<Task> action, string busyText = "Выполняется…") {
        if (!loaded || !pending.Add(control)) return;
        var button = control as ConsoleButton;
        string original = control.Text;
        bool hadFocus = control.ContainsFocus;
        control.Enabled = false;
        var automaticFocus = ActiveControl;
        if (button != null && !button.Key) button.Text = busyText;
        try { await action(); await Poll(); }
        catch (Exception e) { control.AccessibleDescription = e.Message; operationTip.Show(e.Message, control, new Point(0, control.Height + 5), 8000); }
        finally {
            pending.Remove(control);
            if (!quitting) {
                if (button != null) button.Text = original;
                control.Enabled = control == meSelector ? meAvailable : true;
                if (hadFocus && control is ConsoleSelect && control.Enabled && ActiveControl == automaticFocus) control.Focus();
            }
        }
    }
    async Task<object> Api(string route, object data = null, string method = "GET") {
        if (url == null) throw new Exception("Сервер ещё запускается.");
        var request = (HttpWebRequest)WebRequest.Create(url + route);
        request.Proxy = null; request.Method = method;
        request.Timeout = 12000; request.ReadWriteTimeout = 12000;
        using (var timeout = new CancellationTokenSource(12000))
        using (timeout.Token.Register(request.Abort)) {
            if (data != null) {
                byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(data));
                request.ContentType = "application/json"; request.ContentLength = bytes.Length;
                using (var stream = await request.GetRequestStreamAsync()) await stream.WriteAsync(bytes, 0, bytes.Length);
            }
            try {
                using (var response = await request.GetResponseAsync())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return json.DeserializeObject(await reader.ReadToEndAsync());
            } catch (WebException e) {
                if (e.Response != null) {
                    using (var reader = new StreamReader(e.Response.GetResponseStream(), Encoding.UTF8))
                        throw new Exception(TextOf(Get(json.DeserializeObject(reader.ReadToEnd()), "error")));
                }
                throw new Exception("Нет связи с локальным сервером.");
            }
        }
    }
    async Task Save(object patch) {
        config = Obj(await Api("/api/config", patch, "PATCH"));
        RenderMappings();
    }
    async Task LoadPorts() {
        string selected = (ports.SelectedItem as Choice) == null ? TextOf(Get(config, "comPort")) : ((Choice)ports.SelectedItem).Id;
        ports.Items.Clear(); ports.Items.Add(new Choice("auto", "Автоматически · AVMATRIX / CH340"));
        foreach (var item in Items(await Api("/api/ports"))) {
            string path = TextOf(Get(item, "path"));
            ports.Items.Add(new Choice(path, path + " · " + TextOf(Get(item, "manufacturer"))));
        }
        if (selected != "auto" && !HasChoice(ports, selected)) ports.Items.Add(new Choice(selected, selected + " · сейчас отсутствует"));
        Choose(ports, selected);
    }
    static bool HasChoice(ConsoleSelect box, string id) { foreach (Choice item in box.Items) if (item.Id == id) return true; return false; }
    static void Choose(ConsoleSelect box, string id) { foreach (Choice item in box.Items) if (item.Id == id) { box.SelectedItem = item; return; } }
    void RenderMappings() {
        foreach (var lamp in Items(Get(config, "lamps"))) {
            int index = Convert.ToInt32(Get(lamp, "id")) - 1;
            if (index < 0 || index >= 6) continue;
            string selected = TextOf(Get(lamp, "atemInput"));
            var box = mappings[index]; box.CloseDropDown(); box.Items.Clear();
            box.Items.Add(new Choice("0", "Не назначено"));
            foreach (var input in inputs) box.Items.Add(new Choice(TextOf(Get(input, "id")), TextOf(Get(input, "id")) + " · " + TextOf(Get(input, "name"))));
            if (!HasChoice(box, selected)) box.Items.Add(new Choice(selected, "Вход " + selected + " · сохранённый"));
            Choose(box, selected);
        }
    }
    void RenderMixEffects(object connections) {
        var banks = Items(Get(connections, "mixEffects"));
        int selected = Get(connections, "atemMe") == null ? 1 : Convert.ToInt32(Get(connections, "atemMe"));
        string signature = json.Serialize(new object[] { banks, selected });
        var current = meSelector.SelectedItem as Choice;
        if (TextOf(meSelector.Tag) != signature || current == null || current.Id != selected.ToString()) {
            meSelector.Tag = signature; meSelector.CloseDropDown(); meSelector.Items.Clear();
            foreach (var bank in banks) meSelector.Items.Add(new Choice(TextOf(Get(bank, "id")), TextOf(Get(bank, "name"))));
            if (!HasChoice(meSelector, selected.ToString())) meSelector.Items.Add(new Choice(selected.ToString(), "M/E " + selected + (Flag(Get(connections, "atem")) ? " · недоступен" : "")));
            Choose(meSelector, selected.ToString());
        }
        meAvailable = Flag(Get(connections, "atem")) && banks.Length > 0;
        meSelector.Enabled = meAvailable && !pending.Contains(meSelector);
        bool available = false;
        foreach (var bank in banks) if (Convert.ToInt32(Get(bank, "id")) == selected) available = true;
        atemBank.Text = available ? "Tally · M/E " + selected : Flag(Get(connections, "atem")) ? "Выберите доступный M/E" : "";
    }
    async Task Poll() {
        if (busyPoll || quitting || url == null) return;
        busyPoll = true;
        try {
            var status = await Api("/status");
            var connections = Get(status, "connections");
            bool atem = Flag(Get(connections, "atem")), com = Flag(Get(connections, "com"));
            atemStatus.Text = "●  ATEM · " + (atem ? TextOf(Get(connections, "atemName")) + "  " + TextOf(Get(connections, "atemIp")) : "не подключён");
            atemStatus.ForeColor = atem ? green : muted;
            var serial = Get(connections, "serial");
            string state = TextOf(Get(serial, "state")), port = TextOf(Get(serial, "port"));
            string stateName = state == "connecting" ? "подключение…" : state == "selection-required" ? "выберите COM-порт" : state == "error" ? TextOf(Get(serial, "error")) : "поиск устройства…";
            serialStatus.Text = "●  AVMATRIX · " + (com ? port + " · порт открыт" : stateName);
            serialStatus.ForeColor = com ? green : muted;
            var nextInputs = Items(Get(status, "inputs"));
            inputs = nextInputs;
            foreach (var item in Items(Get(status, "lamps"))) {
                int index = Convert.ToInt32(Get(item, "id")) - 1; if (index < 0 || index >= 6) continue;
                bool program = Flag(Get(item, "program")), preview = Flag(Get(item, "preview")), test = Flag(Get(item, "testing"));
                string name = SourceName(Convert.ToInt32(Get(item, "atemInput")));
                programKeys[index].UpdateState(name, program, test && program);
                previewKeys[index].UpdateState(name, preview, test && preview);
                foreach (ConsoleButton button in testButtons) if (button.LampId == index + 1) {
                    button.Active = test && (button.SignalColor == "program" ? program : preview); button.Invalidate();
                }
            }
            RenderMixEffects(connections);
            foreach (var button in testButtons) button.Enabled = com;
            var next = Items(Get(status, "inputs")); string signature = json.Serialize(next);
            if (signature != inputSignature) { inputs = next; inputSignature = signature; if (config != null) RenderMappings(); }
            if (!loaded) {
                config = Obj(await Api("/api/config"));
                ip.Text = TextOf(Get(Get(config, "atem"), "ip")); baud.Text = TextOf(Get(config, "baudRate"));
                Choose(disconnect, TextOf(Get(config, "onAtemDisconnect")));
                await LoadPorts(); RenderMappings(); loaded = true;
                notice.Text = "";
            }
        } catch (Exception e) {
            atemStatus.Text = "●  ATEM · нет данных"; atemStatus.ForeColor = muted;
            serialStatus.Text = "●  AVMATRIX · нет данных"; serialStatus.ForeColor = muted;
            foreach (var button in testButtons) button.Enabled = false;
            meAvailable = false; meSelector.Enabled = false;
            notice.Text = e.Message; notice.ForeColor = red;
        } finally { busyPoll = false; }
    }
    async Task Boot() {
        try {
            Directory.CreateDirectory(Path.Combine(home, "TallyLights-data"));
            runtime = await Task.Run(() => RuntimePayload.Open(home));
            if (quitting) return;
            Receive("TALLY_RUNTIME " + runtime.Root);
            var start = new ProcessStartInfo(Path.Combine(runtime.Root, "node.exe"), "src/index.js --desktop") {
                WorkingDirectory = runtime.Root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            start.EnvironmentVariables["TALLY_DATA_DIR"] = Path.Combine(home, "TallyLights-data");
            job = new ServerJob();
            server = new Process { StartInfo = start, EnableRaisingEvents = true };
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Receive(e.Data); };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Receive(e.Data); };
            server.Exited += delegate {
                ready.TrySetException(new Exception("Сервер завершился. Подробности: TallyLights-data/server.log"));
                if (!quitting && IsHandleCreated) BeginInvoke((Action)(delegate {
                    poll.Stop(); loaded = false;
                    notice.Text = "Сервер остановлен. Перезапустите приложение; подробности в server.log."; notice.ForeColor = red;
                    atemStatus.Text = "●  ATEM · нет связи с сервером"; serialStatus.Text = "●  AVMATRIX · нет связи с сервером";
                    foreach (var button in testButtons) button.Enabled = false;
                    meAvailable = false; meSelector.Enabled = false;
                }));
            };
            server.Start(); job.Add(server);
            server.BeginOutputReadLine(); server.BeginErrorReadLine();
            if (await Task.WhenAny(ready.Task, Task.Delay(15000)) != ready.Task) throw new Exception("Сервер не запустился за 15 секунд. Проверьте server.log.");
            int port = await ready.Task;
            if (quitting) return;
            if (server.HasExited) throw new Exception("Сервер завершился при запуске.");
            url = "http://127.0.0.1:" + port;
            await Poll(); poll.Start();
        } catch (Exception e) {
            if (quitting) return;
            notice.Text = e.Message; notice.ForeColor = red;
            MessageBox.Show(this, e.Message, "TallyLights — ошибка запуска", MessageBoxButtons.OK, MessageBoxIcon.Error);
            BeginInvoke((Action)(async delegate { await Quit(); }));
        }
    }
    readonly object logLock = new object();
    void Receive(string line) {
        if (line == null) return;
        lock (logLock) {
            try {
                string file = Path.Combine(home, "TallyLights-data", "server.log");
                if (File.Exists(file) && new FileInfo(file).Length > 2 * 1024 * 1024) File.WriteAllText(file, "");
                File.AppendAllText(file, line + Environment.NewLine, Encoding.UTF8);
            } catch {}
        }
        if (line.StartsWith("TALLY_READY ")) {
            try { ready.TrySetResult(Convert.ToInt32(Get(new JavaScriptSerializer().DeserializeObject(line.Substring(12)), "port"))); }
            catch (Exception e) { ready.TrySetException(e); }
        }
    }
    async Task Quit() {
        if (quitting) return;
        quitting = true; poll.Stop(); notice.Text = "Завершение работы…";
        ready.TrySetCanceled();
        if (bootTask != null) await bootTask;
        await Task.Run((Action)(delegate {
            if (server == null) return;
            try {
                if (!server.HasExited) {
                    server.StandardInput.WriteLine("shutdown"); server.StandardInput.Flush();
                    if (!server.WaitForExit(8000)) server.Kill();
                }
            } catch { try { server.Kill(); } catch {} }
        }));
        tray.Visible = false; Close();
    }
    protected override void Dispose(bool disposing) {
        if (disposing) {
            poll.Dispose(); tray.Dispose();
            if (job != null) job.Dispose();
            if (server != null) server.Dispose();
            if (runtime != null) runtime.Dispose();
            operationTip.Dispose();
        }
        base.Dispose(disposing);
    }
}
