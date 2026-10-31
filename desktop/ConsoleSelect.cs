using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

// A fully painted selector and popup: no system ComboBox frame, native selection
// rectangle or OS list window. Programmatic changes never emit a user commit.
internal sealed class ConsoleSelect : Control {
    public readonly List<object> Items = new List<object>();
    public int DropDownWidth { get; set; }
    public event EventHandler SelectionChangeCommitted;
    object selected;
    ToolStripDropDown popup;
    TextBox editor;
    ComboBoxStyle style = ComboBoxStyle.DropDownList;
    bool over;
    public ConsoleSelect() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        Size = new Size(210, 32); Margin = Padding.Empty; TabStop = true;
        Font = new Font("Segoe UI", 9); BackColor = ConsoleTheme.Well; ForeColor = ConsoleTheme.Text;
        AccessibleRole = AccessibleRole.ComboBox;
    }
    public ComboBoxStyle DropDownStyle {
        get { return style; }
        set {
            style = value;
            if (value == ComboBoxStyle.DropDown && editor == null) {
                editor = new TextBox { BorderStyle = BorderStyle.None, BackColor = BackColor, ForeColor = ForeColor, Font = Font, TabStop = false };
                editor.TextChanged += delegate { if (base.Text != editor.Text) Text = editor.Text; };
                editor.KeyDown += delegate(object sender, KeyEventArgs e) {
                    if (e.KeyCode == Keys.Down || e.KeyCode == Keys.F4) { OpenDropDown(); e.SuppressKeyPress = true; }
                };
                Controls.Add(editor); LayoutEditor();
            }
            if (editor != null) editor.Visible = value == ComboBoxStyle.DropDown;
            Invalidate();
        }
    }
    public object SelectedItem {
        get { return selected; }
        set { selected = value; Text = value == null ? "" : value.ToString(); Invalidate(); }
    }
    public int SelectedIndex { get { return Items.IndexOf(selected); } }
    public override string Text {
        get { return base.Text; }
        set { base.Text = value; if (editor != null && editor.Text != value) editor.Text = value; Invalidate(); }
    }
    void LayoutEditor() {
        if (editor != null) editor.Bounds = new Rectangle(10, Math.Max(3, (Height - editor.PreferredHeight) / 2), Math.Max(1, Width - 38), editor.PreferredHeight);
    }
    protected override void OnSizeChanged(EventArgs e) { base.OnSizeChanged(e); LayoutEditor(); CloseDropDown(); Invalidate(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); if (!Enabled) CloseDropDown(); Invalidate(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected override void OnMouseEnter(EventArgs e) { over = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { over = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || !Enabled) return;
        Focus(); if (popup == null) OpenDropDown(); else CloseDropDown();
    }
    protected override bool IsInputKey(Keys key) {
        Keys code = key & Keys.KeyCode;
        return code == Keys.Down || code == Keys.Up || code == Keys.Home || code == Keys.End || code == Keys.Enter || code == Keys.Space || base.IsInputKey(key);
    }
    protected override void OnKeyDown(KeyEventArgs e) {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Down || e.KeyCode == Keys.Up || e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter || e.KeyCode == Keys.F4) {
            OpenDropDown(); e.Handled = e.SuppressKeyPress = true;
        }
    }
    public void CloseDropDown() { if (popup != null) popup.Close(); }
    public void OpenDropDown() {
        if (!Enabled || Items.Count == 0 || popup != null) return;
        var area = Screen.FromControl(this).WorkingArea;
        int width = Math.Min(area.Width, Math.Max(Width, DropDownWidth));
        int height = Math.Min(Items.Count, 8) * 32 + 10;
        var below = PointToScreen(new Point(0, Height + 5));
        var above = PointToScreen(Point.Empty);
        int space = Math.Max(area.Bottom - below.Y, above.Y - area.Top - 5);
        height = Math.Min(height, Math.Max(42, space));
        var list = new SelectList(this) { Size = new Size(width, height) };
        var host = new ToolStripControlHost(list) { AutoSize = false, Size = list.Size, Margin = Padding.Empty, Padding = Padding.Empty };
        var menu = new ToolStripDropDown { AutoSize = false, Size = list.Size, Padding = Padding.Empty, Margin = Padding.Empty,
            BackColor = ConsoleTheme.Well, DropShadowEnabled = false, Renderer = new PopupRenderer() };
        popup = menu; menu.Items.Add(host);
        menu.Closed += delegate {
            if (popup == menu) popup = null;
            // ToolStrip is still unwinding SetVisibleCore during Closed. Dispose
            // after that stack returns so selecting an item cannot invalidate it.
            if (IsHandleCreated && !IsDisposed) BeginInvoke((Action)menu.Dispose); else menu.Dispose();
            Invalidate();
        };
        int y = below.Y + height <= area.Bottom ? below.Y : above.Y - height - 5;
        menu.Show(new Point(Math.Max(area.Left, Math.Min(below.X, area.Right - width)), Math.Max(area.Top, y)));
        list.Focus(); Invalidate();
    }
    void Commit(int index) {
        if (index < 0 || index >= Items.Count) return;
        object next = Items[index]; bool changed = selected != next || Text != next.ToString();
        CloseDropDown(); SelectedItem = next; Focus();
        if (changed && SelectionChangeCommitted != null) SelectionChangeCommitted(this, EventArgs.Empty);
    }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; var background = Parent;
        while (background != null && background.BackColor.A == 0) background = background.Parent;
        g.Clear(background == null ? ConsoleTheme.Panel : background.BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = ConsoleTheme.Rounded(bounds, 5)) {
            using (var b = new SolidBrush(Enabled ? ConsoleTheme.Well : Color.FromArgb(38, 40, 43))) g.FillPath(b, path);
            using (var p = new Pen(over && Enabled ? Color.FromArgb(85, 90, 98) : ConsoleTheme.Line)) g.DrawPath(p, path);
        }
        var color = Enabled ? ConsoleTheme.Text : Color.FromArgb(112, 117, 125);
        if (editor == null || !editor.Visible) TextRenderer.DrawText(g, Text, Font, new Rectangle(10, 1, Width - 37, Height - 2), color,
            TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
        using (var brush = new SolidBrush(Enabled ? ConsoleTheme.Muted : Color.FromArgb(89, 94, 101))) {
            int x = Width - 16, y = Height / 2;
            g.FillPolygon(brush, new[] { new Point(x - 4,y - 2), new Point(x + 4,y - 2), new Point(x,y + 2) });
        }
        if (Focused && ShowFocusCues && Enabled) using (var pen = new Pen(ConsoleTheme.Muted)) g.DrawLine(pen, 10, Height - 4, Width - 30, Height - 4);
    }
    protected override AccessibleObject CreateAccessibilityInstance() { return new SelectAccessible(this); }
    sealed class SelectAccessible : ControlAccessibleObject {
        readonly ConsoleSelect owner;
        public SelectAccessible(ConsoleSelect owner) : base(owner) { this.owner = owner; }
        public override AccessibleRole Role { get { return AccessibleRole.ComboBox; } }
        public override string Value { get { return owner.Text; } set { owner.Text = value; } }
        public override string DefaultAction { get { return "Открыть"; } }
        public override Rectangle Bounds { get { return owner.RectangleToScreen(owner.ClientRectangle); } }
        public override void DoDefaultAction() { owner.OpenDropDown(); }
        public override AccessibleStates State { get { return base.State | (owner.Enabled ? (owner.popup == null ? AccessibleStates.Collapsed : AccessibleStates.Expanded) : AccessibleStates.Unavailable); } }
    }
    sealed class PopupRenderer : ToolStripProfessionalRenderer {
        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) {}
    }
    sealed class SelectList : Control {
        readonly ConsoleSelect owner;
        int cursor, first;
        string query = ""; int queryTime;
        int VisibleCount { get { return Math.Max(1, (Height - 10) / 32); } }
        public SelectList(ConsoleSelect owner) {
            this.owner = owner; Font = owner.Font; BackColor = ConsoleTheme.Well; TabStop = true;
            SetStyle(ControlStyles.Selectable | ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            cursor = Math.Max(0, owner.SelectedIndex);
            if (owner.SelectedIndex < 0) { int found = owner.Items.FindIndex(item => item.ToString() == owner.Text); if (found >= 0) cursor = found; }
            AccessibleRole = AccessibleRole.List;
        }
        protected override void OnSizeChanged(EventArgs e) { base.OnSizeChanged(e); EnsureVisible(); }
        void EnsureVisible() { if (cursor < first) first = cursor; if (cursor >= first + VisibleCount) first = cursor - VisibleCount + 1; Invalidate(); }
        int Hit(Point point) { int row = (point.Y - 5) / 32 + first; return point.Y >= 5 && point.Y < Height - 5 && row < owner.Items.Count ? row : -1; }
        protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); int index = Hit(e.Location); if (index >= 0 && cursor != index) { cursor = index; Invalidate(); } }
        protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); if (e.Button == MouseButtons.Left) owner.Commit(Hit(e.Location)); }
        protected override void OnMouseWheel(MouseEventArgs e) { first = Math.Max(0, Math.Min(owner.Items.Count - VisibleCount, first - Math.Sign(e.Delta) * 3)); Invalidate(); base.OnMouseWheel(e); }
        protected override bool IsInputKey(Keys key) { return true; }
        protected override void OnKeyDown(KeyEventArgs e) {
            base.OnKeyDown(e);
            bool navigation = e.KeyCode == Keys.Escape || e.KeyCode == Keys.Tab || e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space || e.KeyCode == Keys.Down || e.KeyCode == Keys.Up || e.KeyCode == Keys.Home || e.KeyCode == Keys.End;
            e.Handled = e.SuppressKeyPress = navigation;
            if (e.KeyCode == Keys.Escape) { owner.CloseDropDown(); owner.Focus(); return; }
            if (e.KeyCode == Keys.Tab) {
                bool forward = !e.Shift; owner.CloseDropDown();
                Control scope = owner.FindForm(); if (scope == null) scope = owner.Parent;
                if (scope != null) scope.SelectNextControl(owner, forward, true, true, true);
                return;
            }
            if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) { owner.Commit(cursor); return; }
            if (e.KeyCode == Keys.Down) cursor = Math.Min(owner.Items.Count - 1, cursor + 1);
            if (e.KeyCode == Keys.Up) cursor = Math.Max(0, cursor - 1);
            if (e.KeyCode == Keys.Home) cursor = 0;
            if (e.KeyCode == Keys.End) cursor = owner.Items.Count - 1;
            EnsureVisible();
        }
        protected override void OnKeyPress(KeyPressEventArgs e) {
            base.OnKeyPress(e); if (char.IsControl(e.KeyChar)) return;
            int now = Environment.TickCount; if (unchecked(now - queryTime) > 800) query = ""; queryTime = now; query += e.KeyChar;
            int found = owner.Items.FindIndex(item => item.ToString().StartsWith(query, StringComparison.CurrentCultureIgnoreCase));
            if (found >= 0) { cursor = found; EnsureVisible(); } e.Handled = true;
        }
        protected override void OnPaint(PaintEventArgs e) {
            var g = e.Graphics; g.Clear(ConsoleTheme.Well); g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var pen = new Pen(ConsoleTheme.Line)) using (var shape = ConsoleTheme.Rounded(new Rectangle(0,0,Width-1,Height-1),5)) g.DrawPath(pen,shape);
            for (int i = first; i < owner.Items.Count && i < first + VisibleCount; i++) {
                var row = new Rectangle(5, 5 + (i - first) * 32, Width - 10, 32);
                if (i == cursor) using (var brush = new SolidBrush(Color.FromArgb(45,48,52))) using (var path = ConsoleTheme.Rounded(row,4)) g.FillPath(brush,path);
                TextRenderer.DrawText(g, owner.Items[i].ToString(), Font, new Rectangle(row.X+7,row.Y,row.Width-30,row.Height), ConsoleTheme.Text,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
                if (i == owner.SelectedIndex) TextRenderer.DrawText(g, "✓", Font, new Rectangle(row.Right-22,row.Y,18,row.Height), ConsoleTheme.Muted,TextFormatFlags.VerticalCenter);
            }
            if (owner.Items.Count > VisibleCount) {
                int track = Height - 14, thumb = Math.Max(16, track * VisibleCount / owner.Items.Count);
                int y = 7 + (track - thumb) * first / Math.Max(1, owner.Items.Count - VisibleCount);
                using (var brush = new SolidBrush(ConsoleTheme.Line)) g.FillRectangle(brush, Width-4, y, 2, thumb);
            }
        }
        protected override AccessibleObject CreateAccessibilityInstance() { return new ListAccessible(this); }
        sealed class ListAccessible : ControlAccessibleObject {
            readonly SelectList list;
            public ListAccessible(SelectList list) : base(list) { this.list = list; }
            public override int GetChildCount() { return list.owner.Items.Count; }
            public override AccessibleObject GetChild(int index) { return index >= 0 && index < GetChildCount() ? new ItemAccessible(list,index) : null; }
        }
        sealed class ItemAccessible : AccessibleObject {
            readonly SelectList list; readonly int index;
            public ItemAccessible(SelectList list, int index) { this.list = list; this.index = index; }
            public override string Name { get { return list.owner.Items[index].ToString(); } set {} }
            public override AccessibleRole Role { get { return AccessibleRole.ListItem; } }
            public override AccessibleObject Parent { get { return list.AccessibilityObject; } }
            public override Rectangle Bounds { get { return list.RectangleToScreen(new Rectangle(5,5+(index-list.first)*32,list.Width-10,32)); } }
            public override AccessibleStates State { get { return AccessibleStates.Selectable | (index == list.owner.SelectedIndex ? AccessibleStates.Selected : AccessibleStates.None) | (index < list.first || index >= list.first+list.VisibleCount ? AccessibleStates.Offscreen : AccessibleStates.None); } }
            public override string DefaultAction { get { return "Выбрать"; } }
            public override void DoDefaultAction() { list.owner.Commit(index); }
        }
    }
    protected override void Dispose(bool disposing) { if (disposing && popup != null) { var menu = popup; popup = null; menu.Dispose(); } base.Dispose(disposing); }
}
