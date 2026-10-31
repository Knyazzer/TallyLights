using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

// The portable host carries the complete runtime, including native serial bindings.
// Only disposable code is extracted; config and logs always live beside the EXE.
internal sealed class RuntimePayload : IDisposable {
    public string Root { get; private set; }
    readonly bool temporary;
    RuntimePayload(string root, bool temporary) { Root = root; this.temporary = temporary; }
    public static RuntimePayload Open(string home) {
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("TallyLights.Payload")) {
            if (resource == null) return new RuntimePayload(home, false);
            string parent = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "TallyLights-runtime"));
            string root = Path.Combine(parent, Guid.NewGuid().ToString("N"));
            var runtime = new RuntimePayload(root, true);
            try {
                Directory.CreateDirectory(root);
                using (var archive = new ZipArchive(resource, ZipArchiveMode.Read)) {
                    foreach (var entry in archive.Entries) {
                        string target = Path.GetFullPath(Path.Combine(root, entry.FullName));
                        if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("Invalid runtime archive path.");
                        if (entry.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (var source = entry.Open())
                        using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(output);
                    }
                }
                if (!File.Exists(Path.Combine(root, "node.exe")) || !File.Exists(Path.Combine(root, "src", "index.js")))
                    throw new InvalidDataException("Incomplete runtime archive.");
                return runtime;
            } catch { runtime.Dispose(); throw; }
        }
    }
    public void Dispose() {
        if (!temporary || !Directory.Exists(Root)) return;
        // A stopped Node process can retain a binding briefly. Never touch other runs.
        for (int attempt = 0; attempt < 5; attempt++) {
            try { Directory.Delete(Root, true); return; }
            catch (IOException) { Thread.Sleep(100); }
            catch (UnauthorizedAccessException) { Thread.Sleep(100); }
        }
    }
}
