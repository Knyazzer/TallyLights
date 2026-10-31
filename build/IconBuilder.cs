using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

// Same vector geometry as public/logo.svg, rasterized separately at each ICO size.
public static class IconBuilder {
    static Color C(string hex) { return ColorTranslator.FromHtml(hex); }
    static void Line(Graphics g, Pen p, params PointF[] points) { g.DrawLines(p, points); }
    static PointF P(float x, float y) { return new PointF(x, y); }
    static Bitmap Render(int size) {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.ScaleTransform(size / 256f, size / 256f);
            using (var tile = new GraphicsPath()) {
                tile.AddArc(8,8,104,104,180,90); tile.AddArc(144,8,104,104,270,90);
                tile.AddArc(144,144,104,104,0,90); tile.AddArc(8,144,104,104,90,90); tile.CloseFigure();
                using (var b = new SolidBrush(C("#23272d"))) g.FillPath(b,tile);
            }
            using (var rays = new Pen(C("#e4a342"), 10)) {
                rays.StartCap = rays.EndCap = LineCap.Round;
                Line(g,rays,P(128,32),P(128,46)); Line(g,rays,P(63,49),P(73,59)); Line(g,rays,P(193,49),P(183,59));
                Line(g,rays,P(39,104),P(53,104)); Line(g,rays,P(203,104),P(217,104));
            }
            using (var left = new GraphicsPath()) using (var right = new GraphicsPath()) {
                left.AddBezier(128,65,104,65,85,84,85,108); left.AddBezier(85,108,85,133,103,142,109,157); left.AddLine(109,157,128,157); left.CloseFigure();
                right.AddBezier(128,65,152,65,171,84,171,108); right.AddBezier(171,108,171,133,153,142,147,157); right.AddLine(147,157,128,157); right.CloseFigure();
                using (var b = new SolidBrush(C("#ed5964"))) g.FillPath(b,left);
                using (var b = new SolidBrush(C("#54ce91"))) g.FillPath(b,right);
            }
            using (var bulb = new GraphicsPath()) using (var pen = new Pen(C("#edf0f2"),10)) {
                pen.StartCap = pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
                bulb.AddBezier(96,164,96,141,71,133,71,105); bulb.AddBezier(71,105,71,73.5f,96.5f,48,128,48);
                bulb.AddBezier(128,48,159.5f,48,185,73.5f,185,105); bulb.AddBezier(185,105,185,133,160,141,160,164); bulb.CloseFigure();
                g.DrawPath(pen,bulb);
                if (size >= 24) { Line(g,pen,P(111,115),P(128,132),P(145,115)); Line(g,pen,P(128,132),P(128,163)); }
                Line(g,pen,P(100,183),P(156,183)); Line(g,pen,P(109,201),P(147,201));
                if (size >= 24) Line(g,pen,P(120,218),P(136,218));
            }
        }
        return bmp;
    }
    public static void Build(string[] args) {
        int[] sizes = {16,20,24,32,48,64,128,256}; var images = new byte[sizes.Length][];
        for (int i=0;i<sizes.Length;i++) using (var b=Render(sizes[i])) using (var m=new MemoryStream()) {
            if (sizes[i] == 256) b.Save(m,ImageFormat.Png);
            else using (var w = new BinaryWriter(m, System.Text.Encoding.UTF8, true)) {
                int size=sizes[i], maskStride=((size+31)/32)*4;
                w.Write(40); w.Write(size); w.Write(size*2); w.Write((ushort)1); w.Write((ushort)32);
                w.Write(0); w.Write(size*size*4+maskStride*size); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
                for(int y=size-1;y>=0;y--) for(int x=0;x<size;x++) { var p=b.GetPixel(x,y); w.Write(p.B); w.Write(p.G); w.Write(p.R); w.Write(p.A); }
                for(int y=size-1;y>=0;y--) { var mask=new byte[maskStride]; for(int x=0;x<size;x++) if(b.GetPixel(x,y).A==0) mask[x/8]|=(byte)(128>>(x%8)); w.Write(mask); }
            }
            images[i]=m.ToArray();
        }
        using (var writer=new BinaryWriter(File.Create(args[0]))) {
            writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)sizes.Length);
            int offset=6+16*sizes.Length;
            for(int i=0;i<sizes.Length;i++) { writer.Write((byte)(sizes[i]==256?0:sizes[i])); writer.Write((byte)(sizes[i]==256?0:sizes[i])); writer.Write((byte)0); writer.Write((byte)0); writer.Write((ushort)1); writer.Write((ushort)32); writer.Write(images[i].Length); writer.Write(offset); offset+=images[i].Length; }
            foreach(var bytes in images) writer.Write(bytes);
        }
        using (var preview=Render(256)) preview.Save(args[1],ImageFormat.Png);
    }
}
