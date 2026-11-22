# Windows qualification probe. This code is never packaged with Folio.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Run this probe on Windows x64.' }
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$parent = (New-Item -Force -ItemType Directory -Path (Join-Path $repo 'test-results/attachment-ntfs')).FullName
if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($parent)).DriveFormat -ne 'NTFS') { throw 'Run this probe on NTFS.' }
$fixture = Join-Path $parent ([Guid]::NewGuid().ToString('N'))

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class FolioNtfsProbe {
    [StructLayout(LayoutKind.Sequential)]
    struct UnicodeName {
        public ushort Length, MaximumLength;
        public IntPtr Buffer;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ObjectAttributes {
        public int Length;
        public IntPtr RootDirectory, ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoStatus {
        public IntPtr Status, Information;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass,
        [Out] byte[] buffer, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass,
        [In] byte[] buffer, uint size);
    [DllImport("ntdll.dll")]
    static extern int NtCreateFile(out SafeFileHandle handle, uint access, ref ObjectAttributes attributes,
        out IoStatus status, IntPtr allocationSize, uint fileAttributes, uint share,
        uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")]
    static extern int NtSetInformationFile(SafeFileHandle handle, out IoStatus status,
        IntPtr information, uint length, int infoClass);

    const uint ReadAttributes = 0x80, Traverse = 0x20, Delete = 0x10000, Synchronize = 0x100000;
    const uint Directory = 1, NonDirectory = 0x40, Synchronous = 0x20, OpenReparsePoint = 0x200000;
    const uint Create = 2, Open = 1, ShareRead = 1, ShareWrite = 2, ShareDelete = 4;
    const int NameCollision = unchecked((int)0xC0000035);

    static SafeFileHandle OpenChild(SafeFileHandle root, string name, uint access, uint share,
        uint disposition, uint options) {
        IntPtr chars = Marshal.StringToHGlobalUni(name);
        IntPtr unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeName)));
        try {
            var length = checked((ushort)(name.Length * 2));
            Marshal.StructureToPtr(new UnicodeName { Length = length, MaximumLength = length, Buffer = chars }, unicode, false);
            var attrs = new ObjectAttributes { Length = Marshal.SizeOf(typeof(ObjectAttributes)),
                RootDirectory = root.DangerousGetHandle(), ObjectName = unicode, Attributes = 0x40 /* OBJ_CASE_INSENSITIVE */ };
            SafeFileHandle result;
            IoStatus io;
            int status = NtCreateFile(out result, access | Synchronize, ref attrs, out io, IntPtr.Zero, 0, share,
                disposition, options | OpenReparsePoint | Synchronous, IntPtr.Zero, 0);
            GC.KeepAlive(root);
            if (status < 0) throw new IOException("NtCreateFile: 0x" + status.ToString("X8"));
            return result;
        } finally {
            Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
        }
    }

    static int Publish(SafeFileHandle stage, SafeFileHandle root, string leaf) {
        byte[] name = System.Text.Encoding.Unicode.GetBytes(leaf);
        // FILE_LINK_INFORMATION offsets for the x64 ABI. ReplaceIfExists stays false.
        byte[] information = new byte[Math.Max(24, 20 + name.Length)];
        BitConverter.GetBytes(root.DangerousGetHandle().ToInt64()).CopyTo(information, 8);
        BitConverter.GetBytes(name.Length).CopyTo(information, 16);
        name.CopyTo(information, 20);
        IntPtr buffer = Marshal.AllocHGlobal(information.Length);
        try {
            Marshal.Copy(information, 0, buffer, information.Length);
            IoStatus io;
            return NtSetInformationFile(stage, out io, buffer, (uint)information.Length, 11 /* FileLinkInformation */);
        } finally {
            GC.KeepAlive(root);
            Marshal.FreeHGlobal(buffer);
        }
    }

    static byte[] Info(SafeFileHandle handle, int infoClass, uint length) {
        var bytes = new byte[length];
        if (!GetFileInformationByHandleEx(handle, infoClass, bytes, length)) throw new Win32Exception();
        return bytes;
    }

    static bool IsReparse(SafeFileHandle handle) {
        return (BitConverter.ToUInt32(Info(handle, 9 /* FileAttributeTagInfo */, 8), 0) & 0x400) != 0;
    }

    public static void Run(string workspace) {
        string assets = Path.Combine(workspace, "assets");
        using (var root = CreateFileW(workspace, ReadAttributes | Traverse | Synchronize, ShareRead, IntPtr.Zero, 3,
            0x02000000 | OpenReparsePoint, IntPtr.Zero)) {
            Require(!root.IsInvalid && !IsReparse(root), "Workspace handle must be an ordinary directory");
            using (var junction = OpenChild(root, "junction", ReadAttributes, ShareRead, Open, Directory)) {
                Require(IsReparse(junction), "A no-follow open must expose the junction itself");
            }
            using (var destination = OpenChild(root, "assets", ReadAttributes | Traverse, ShareRead | ShareWrite, Open, Directory)) {
                Require(!IsReparse(destination), "Destination must be an ordinary directory");
                RequireRenameBlocked(workspace);
                RequireRenameBlocked(assets);
                using (var stage = OpenChild(destination, ".stage", 0xC0000000 | Delete, ShareRead, Create, NonDirectory))
                using (var stream = new FileStream(stage, FileAccess.ReadWrite)) {
                    stream.WriteByte(0x42);
                    stream.Flush(true);
                    stream.Position = 0;
                    Require(stream.ReadByte() == 0x42 && stream.ReadByte() == -1, "Exact staged bytes");
                    int status = Publish(stage, destination, "present.png");
                    Require(status == NameCollision, "Existing name must win: 0x" + status.ToString("X8"));
                    status = Publish(stage, destination, "PRESENT.PNG");
                    Require(status == NameCollision, "Existing case variant must win: 0x" + status.ToString("X8"));
                    status = Publish(stage, destination, "caf\u00e9.png");
                    Require(status == 0, "Anchored publication of composed name: 0x" + status.ToString("X8"));
                    using (var final = OpenChild(destination, "caf\u00e9.png", ReadAttributes,
                        ShareRead | ShareWrite | ShareDelete, Open, NonDirectory)) {
                        Require(Convert.ToBase64String(Info(stage, 18 /* FileIdInfo */, 24)) ==
                            Convert.ToBase64String(Info(final, 18, 24)), "Published and staged file IDs must match");
                    }
                    if (!SetFileInformationByHandle(stage, 4 /* FileDispositionInfo */, new byte[] { 1 }, 1)) {
                        throw new Win32Exception();
                    }
                }
            }
        }
    }

    static void RequireRenameBlocked(string path) {
        try { System.IO.Directory.Move(path, path + "-moved"); }
        catch (IOException) { return; }
        catch (UnauthorizedAccessException) { return; }
        throw new IOException("Rename unexpectedly succeeded: " + path);
    }

    static void Require(bool condition, string message) {
        if (!condition) throw new IOException(message);
    }
}
'@

try {
    $workspace = Join-Path $fixture 'workspace'
    $assets = (New-Item -ItemType Directory -Force -Path (Join-Path $workspace 'assets')).FullName
    $outside = (New-Item -ItemType Directory -Path (Join-Path $fixture 'other-root')).FullName
    New-Item -ItemType Junction -Path (Join-Path $workspace 'junction') -Target $outside | Out-Null
    [IO.File]::WriteAllText((Join-Path $assets 'present.png'), 'existing')
    $decomposed = Join-Path $assets ("cafe$([char]0x0301).png")
    $composed = Join-Path $assets ("caf$([char]0x00e9).png")
    [IO.File]::WriteAllText($decomposed, 'distinct entry')
    [FolioNtfsProbe]::Run($workspace)
    if ([IO.File]::ReadAllText((Join-Path $assets 'present.png')) -cne 'existing' -or
        [IO.File]::ReadAllText($decomposed) -cne 'distinct entry' -or
        [IO.File]::ReadAllText($composed) -cne 'B' -or
        (Test-Path -LiteralPath (Join-Path $assets '.stage')) -or
        @(Get-ChildItem -Force -LiteralPath $outside).Count -ne 0) { throw 'Unexpected on-disk bytes or escaped write.' }
    [IO.Directory]::Move($assets, "$assets-moved")
    [IO.Directory]::Move($workspace, "$workspace-moved")
    Write-Output 'NTFS probe passed: held directory renames refused, junction detected, exact-name no-overwrite, matching file IDs, and live stage cleanup verified. Canonically equivalent publication still succeeded.'
} finally {
    if (Test-Path -LiteralPath $fixture) {
        $resolved = (Resolve-Path -LiteralPath $fixture).ProviderPath
        if ($resolved -ne $fixture -or (Split-Path -Parent $resolved) -ne $parent) { throw 'Unexpected fixture path.' }
        # Unlink the fixture junction before recursive cleanup in Windows PowerShell.
        Get-ChildItem -LiteralPath $fixture -Directory -Filter 'workspace*' | ForEach-Object {
            $junction = Join-Path $_.FullName 'junction'
            if ((Get-Item -LiteralPath $junction -ErrorAction SilentlyContinue).LinkType -eq 'Junction') { [IO.Directory]::Delete($junction) }
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
