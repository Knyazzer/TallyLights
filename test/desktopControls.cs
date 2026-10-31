using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

// In-process WinForms regression checks. No real backend, network or hardware.
internal static class DesktopControlTests {
    static int assertions;
    static void Check(bool value, string message) { if (!value) throw new Exception(message); assertions++; }
    static object Field(object target, string name) { return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target); }
    static Control Find(Control root, string text) { foreach (Control c in root.Controls) { if (c.Text == text) return c; var found = Find(c,text); if (found != null) return found; } return null; }
    static Control List(ConsoleSelect select) { var menu = (ToolStripDropDown)Field(select,"popup"); return ((ToolStripControlHost)menu.Items[0]).Control; }
    static void Key(Control control, Keys key) { control.GetType().GetMethod("OnKeyDown",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(control,new object[]{new KeyEventArgs(key)}); }
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        int result = 1;
        using (var host = new Form { ClientSize = new Size(500,300) }) {
            var select = new ConsoleSelect { Location = new Point(20,20) };
            select.Items.AddRange(new object[]{"Main","Close","Wide","Right"}); select.SelectedItem = select.Items[0];
            int commits = 0; select.SelectionChangeCommitted += delegate { commits++; };
            host.Controls.Add(select);
            host.Shown += async delegate {
                try {
                    select.SelectedItem = select.Items[1]; Check(commits == 0,"Programmatic update emitted a commit");
                    select.Enabled = false; select.OpenDropDown(); Check(Field(select,"popup") == null,"Disabled selector opened");
                    Check((select.AccessibilityObject.State & AccessibleStates.Unavailable) != 0,"Disabled accessibility state missing");
                    select.Enabled = true; select.OpenDropDown();
                    var list = List(select); list.AccessibilityObject.GetChild(2).DoDefaultAction();
                    await Task.Delay(30);
                    Check(select.Text == "Wide" && commits == 1,"Popup selection did not commit exactly once");
                    Check(Field(select,"popup") == null,"Popup remained after selection");
                    select.OpenDropDown(); list = List(select); Key(list,Keys.End); Key(list,Keys.Escape); await Task.Delay(30);
                    Check(select.Text == "Wide" && commits == 1,"Escape changed the selection");
                    select.OpenDropDown(); list = List(select); Key(list,Keys.Home); Key(list,Keys.Down); Key(list,Keys.Enter); await Task.Delay(30);
                    Check(select.Text == "Close" && commits == 2,"Keyboard selection failed");
                    select.OpenDropDown(); list = List(select);
                    list.GetType().GetMethod("OnKeyPress",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(list,new object[]{new KeyPressEventArgs('R')});
                    Key(list,Keys.Enter); await Task.Delay(30); Check(select.Text == "Right","Typeahead failed");
                    select.Items.Clear(); for(int i=0;i<40;i++) select.Items.Add("Input " + i);
                    select.SelectedItem = select.Items[0]; select.OpenDropDown(); list = List(select); Key(list,Keys.End); Key(list,Keys.Enter); await Task.Delay(30);
                    Check(select.Text == "Input 39","Long popup did not scroll to its last item");
                    using (var main = new MainForm(AppDomain.CurrentDomain.BaseDirectory)) {
                        var shell = (TableLayoutPanel)main.Controls[0]; main.CreateControl(); main.PerformLayout();
                        Check(shell.RowCount == 3,"A status row can move the navigation");
                        Check(Find(main,"Software Control") == null && Find(main,"Tally Lights") != null,"Internal heading is not simplified");
                        var bank = (ConsoleSelect)Field(main,"meSelector"); Check(!bank.Enabled,"M/E enabled before connecting");
                        Check(Find(main,"В трей") == null && Find(main,"Выход") == null,"Duplicate exit buttons returned");
                        var scan = Find(main,"Сканировать сеть"); var footer = shell.GetControlFromPosition(0,2);
                        var before = footer.Bounds; typeof(MainForm).GetField("loaded",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(main,true);
                        var action = (Task)typeof(MainForm).GetMethod("Action",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(main,new object[]{scan,new Func<Task>(async delegate { await Task.Delay(100); }),"Сканирование…"});
                        Check(scan.Text == "Сканирование…","Scan progress is not inside the button");
                        main.PerformLayout(); Check(footer.Bounds == before,"Busy feedback moved the navigation");
                        await action; main.PerformLayout(); Check(footer.Bounds == before && scan.Text == "Сканировать сеть","Completed feedback moved navigation or lost button text");
                        var renderBanks = typeof(MainForm).GetMethod("RenderMixEffects",BindingFlags.Instance|BindingFlags.NonPublic);
                        var connections = new Dictionary<string,object> { {"atem",true}, {"atemMe",1}, {"mixEffects",new object[]{new Dictionary<string,object>{{"id",1},{"name","M/E 1"}}}} };
                        renderBanks.Invoke(main,new object[]{connections}); Check(bank.Enabled,"Connected M/E not enabled");
                        var bankAction = (Task)typeof(MainForm).GetMethod("Action",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(main,new object[]{bank,new Func<Task>(async delegate { await Task.Delay(30); }),""});
                        await bankAction; Check(bank.Enabled,"M/E did not re-enable after saving");
                        bankAction = (Task)typeof(MainForm).GetMethod("Action",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(main,new object[]{bank,new Func<Task>(async delegate { await Task.Delay(30); }),""});
                        connections["atem"] = false; renderBanks.Invoke(main,new object[]{connections}); await bankAction;
                        Check(!bank.Enabled,"M/E re-enabled after connection loss during save");
                        main.ClientSize = new Size(1500,1000); main.PerformLayout();
                        Check(footer.Bottom == shell.ClientSize.Height,"Navigation detached after resize");
                        var pages = (Panel[])Field(main,"pages"); var frame = pages[0].Parent;
                        Check(frame is ConsoleSurface && frame.Padding == new Padding(1),"Workspace border is not isolated outside the pages");
                        foreach (Size size in new[]{new Size(1220,920),new Size(1700,1000),new Size(1140,860)}) {
                            main.ClientSize = size; main.PerformLayout();
                            for(int page=0;page<3;page++) {
                                typeof(MainForm).GetMethod("SelectPage",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(main,new object[]{page});
                                frame.PerformLayout();
                                using(var image = new Bitmap(frame.Width,frame.Height)) {
                                    frame.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));
                                    bool intact = true;
                                    for(int x=0;x<image.Width;x++) intact &= image.GetPixel(x,0).ToArgb()==ConsoleTheme.Line.ToArgb() && image.GetPixel(x,image.Height-1).ToArgb()==ConsoleTheme.Line.ToArgb();
                                    for(int y=0;y<image.Height;y++) intact &= image.GetPixel(0,y).ToArgb()==ConsoleTheme.Line.ToArgb() && image.GetPixel(image.Width-1,y).ToArgb()==ConsoleTheme.Line.ToArgb();
                                    Check(intact,"Workspace border interrupted on page " + page + " at " + size);
                                }
                            }
                        }
                    }
                    File.WriteAllText(args[0],"PASS: " + assertions + " WinForms checks (menu lifecycle, pointer-equivalent commit, keyboard, Escape, typeahead, long lists, disabled M/E, stable busy/resize layout)."); result = 0;
                } catch(Exception e) { File.WriteAllText(args[0],e.ToString()); }
                finally { host.Close(); }
            };
            try { Application.Run(host); } catch(Exception e) { File.WriteAllText(args[0],e.ToString()); }
        }
        return result;
    }
}
