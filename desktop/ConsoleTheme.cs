using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

internal static class ConsoleTheme {
    public static readonly Color Workspace = Color.FromArgb(25, 26, 28);
    public static readonly Color Panel = Color.FromArgb(35, 37, 39);
    public static readonly Color Well = Color.FromArgb(26, 27, 30);
    public static readonly Color Line = Color.FromArgb(56, 59, 64);
    public static readonly Color Text = Color.FromArgb(237, 240, 242);
    public static readonly Color Muted = Color.FromArgb(162, 167, 174);
    public static readonly Color Amber = Color.FromArgb(228, 163, 66);
    public static readonly Color Program = Color.FromArgb(237, 89, 100);
    public static readonly Color Preview = Color.FromArgb(84, 206, 145);
    public static void Frame(Graphics g, Rectangle r, Color top, Color bottom) {
        using (var pen = new Pen(Line)) g.DrawRectangle(pen, r);
    }
    public static void Fill(Graphics g, Rectangle r, Color top, Color bottom) {
        if (r.Width <= 0 || r.Height <= 0) return;
        using (var brush = new SolidBrush(top)) g.FillRectangle(brush, r);
    }
    public static GraphicsPath Rounded(Rectangle r, int radius) {
        var path = new GraphicsPath(); int d = radius * 2;
        path.AddArc(r.Left, r.Top, d, d, 180, 90); path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90); path.CloseFigure();
        return path;
    }

}
internal sealed class ConsoleSurface : Panel {
    public bool Gradient;
    public ConsoleSurface() { DoubleBuffered = true; BackColor = ConsoleTheme.Panel; SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint, true); }
    protected override void OnPaintBackground(PaintEventArgs e) {
        e.Graphics.Clear(Gradient ? Color.FromArgb(32, 34, 36) : BackColor);
    }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        if (Width > 1 && Height > 1) ConsoleTheme.Frame(e.Graphics, new Rectangle(0, 0, Width - 1, Height - 1), Color.FromArgb(65, 65, 65), ConsoleTheme.Line);
    }
    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(true); }
}
internal sealed class ConsoleTable : TableLayoutPanel {
    public ConsoleTable() { DoubleBuffered = true; BackColor = ConsoleTheme.Panel; SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint, true); }
    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(true); }
}
internal sealed class ConsoleFlow : FlowLayoutPanel {
    public ConsoleFlow() { DoubleBuffered = true; SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint, true); }
    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(true); }
}
internal sealed class ConsolePanel : Panel {
    public ConsolePanel() { DoubleBuffered = true; BackColor = ConsoleTheme.Panel; SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint, true); }
    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(true); }
}
internal sealed class ConsoleButton : Button {
    public bool Navigation, Active, Key;
    public int Glyph, LampId;
    public string SignalColor;
    bool over, pressed;
    public ConsoleButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false; BackColor = ConsoleTheme.Panel; ForeColor = ConsoleTheme.Text;
        Cursor = Cursors.Hand; Font = new Font("Segoe UI", 9);
    }
    protected override void OnMouseEnter(EventArgs e) { over = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { over = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics;
        g.Clear(BackColor);
        var r = new Rectangle(1, 1, Width - 3, Height - 3);
        if (Navigation) {
            if (Active || over) {
                ConsoleTheme.Fill(g, r, Color.FromArgb(41, 42, 44), Color.FromArgb(41, 42, 44));
                if (Active) using (var pen = new Pen(ConsoleTheme.Amber, 2)) g.DrawLine(pen, r.Left, r.Top, r.Right, r.Top);
            }
            Color color = Active ? ConsoleTheme.Amber : ConsoleTheme.Muted;
            DrawGlyph(g, new Point(Width / 2, 17), Glyph, color);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(0, 31, Width, Height - 32), color, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            if (Focused && ShowFocusCues) using (var pen = new Pen(ConsoleTheme.Amber)) g.DrawRectangle(pen, new Rectangle(3, 3, Width - 7, Height - 7));
            return;
        }
        if (Key) {
            TallyKey.DrawKey(g, r, Text, Active, SignalColor == "program" ? ConsoleTheme.Program : ConsoleTheme.Preview, Enabled, Font);
            if (Focused && ShowFocusCues) using (var pen = new Pen(ConsoleTheme.Amber)) g.DrawRectangle(pen, Rectangle.Inflate(r, -5, -5));
            return;
        }
        Color top = pressed ? Color.FromArgb(43, 46, 51) : over ? Color.FromArgb(65, 70, 78) : Color.FromArgb(52, 56, 62);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = ConsoleTheme.Rounded(r, 5)) {
            using (var brush = new SolidBrush(top)) g.FillPath(brush, path);
            using (var pen = new Pen(Color.FromArgb(72, 77, 85))) g.DrawPath(pen, path);
        }
        if (Focused && ShowFocusCues) using (var pen = new Pen(ConsoleTheme.Amber)) g.DrawRectangle(pen, r);
        TextRenderer.DrawText(g, Text, Font, r, Enabled ? ForeColor : Color.FromArgb(108, 108, 108),
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
    static void DrawGlyph(Graphics g, Point c, int kind, Color color) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var pen = new Pen(color, 1.5f)) {
            if (kind == 0) {
                g.DrawEllipse(pen, c.X - 6, c.Y - 6, 12, 12); g.DrawEllipse(pen, c.X - 2, c.Y - 2, 4, 4);
                for (int i = 0; i < 8; i++) { double angle = i * Math.PI / 4; g.DrawLine(pen, c.X + (float)Math.Cos(angle) * 7, c.Y + (float)Math.Sin(angle) * 7, c.X + (float)Math.Cos(angle) * 10, c.Y + (float)Math.Sin(angle) * 10); }
            } else if (kind == 1) {
                g.DrawRectangle(pen, c.X - 4, c.Y - 9, 8, 5); g.DrawLine(pen, c.X, c.Y - 4, c.X, c.Y + 2);
                g.DrawLine(pen, c.X - 9, c.Y + 2, c.X + 9, c.Y + 2);
                g.DrawRectangle(pen, c.X - 12, c.Y + 4, 6, 5); g.DrawRectangle(pen, c.X - 3, c.Y + 4, 6, 5); g.DrawRectangle(pen, c.X + 6, c.Y + 4, 6, 5);
            } else {
                g.DrawRectangle(pen, c.X - 10, c.Y - 8, 20, 16);
                g.DrawLine(pen, c.X - 6, c.Y, c.X - 2, c.Y); g.DrawLine(pen, c.X - 2, c.Y, c.X, c.Y - 4);
                g.DrawLine(pen, c.X, c.Y - 4, c.X + 3, c.Y + 4); g.DrawLine(pen, c.X + 3, c.Y + 4, c.X + 5, c.Y);
                g.DrawLine(pen, c.X + 5, c.Y, c.X + 8, c.Y);
            }
        }
    }
}
internal sealed class TallyKey : Control {
    bool active, testing;
    string source = "";
    public Color Signal = ConsoleTheme.Program;
    public TallyKey() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Font = new Font("Segoe UI", 9, FontStyle.Bold); AccessibleRole = AccessibleRole.StaticText; TabStop = false;
        BackColor = ConsoleTheme.Workspace;
    }
    public void UpdateState(string name, bool value, bool test) {
        if (source == name && active == value && testing == test) return;
        source = name; active = value; testing = test; AccessibleName = Text + " · " + name + (active ? " · активно" : " · выключено"); Invalidate();
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(BackColor);
        DrawKey(e.Graphics, new Rectangle(1, 1, Width - 3, Height - 3), Text + "\n" + source, active, Signal, true, Font);
        if (testing) using (var brush = new SolidBrush(ConsoleTheme.Amber)) e.Graphics.FillEllipse(brush, Width - 11, 6, 5, 5);
    }
    public static void DrawKey(Graphics g, Rectangle r, string text, bool active, Color color, bool enabled, Font font) {
        if (r.Width < 15 || r.Height < 15) return;
        bool program = color == ConsoleTheme.Program;
        Color fill = active ? (program ? Color.FromArgb(113, 49, 59) : Color.FromArgb(34, 91, 66)) : Color.FromArgb(45, 48, 52);
        Color border = active ? (program ? Color.FromArgb(211, 79, 96) : Color.FromArgb(59, 180, 123)) : Color.FromArgb(66, 70, 76);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var shape = ConsoleTheme.Rounded(r, 6)) {
            using (var brush = new SolidBrush(fill)) g.FillPath(brush, shape);
            using (var pen = new Pen(border)) g.DrawPath(pen, shape);
        }
        TextRenderer.DrawText(g, text, font, Rectangle.Inflate(r, -7, -6), enabled ? ConsoleTheme.Text : ConsoleTheme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.WordBreak);

    }
}
