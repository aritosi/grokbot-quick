import {execFile,spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {StringDecoder} from 'node:string_decoder';

// Read the foreground Finder or Explorer window only. A background selection stays put.
const finderScript = `tell application "System Events"
  set frontApp to bundle identifier of first application process whose frontmost is true
end tell
if frontApp is not "com.apple.finder" then return ""
tell application "Finder"
  set selectedPaths to {}
  try
    repeat with selectedFile in (selection as alias list)
      set end of selectedPaths to POSIX path of selectedFile
    end repeat
  end try
  set AppleScript's text item delimiters to linefeed
  return selectedPaths as text
end tell`;

const explorerScript = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GbaForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
}
"@
$hwnd = [GbaForeground]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }
$processId = 0
[void][GbaForeground]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if (-not $process -or $process.ProcessName -ne 'explorer') { exit 0 }
$foreground = [uint32]([int64]$hwnd -band 0xFFFFFFFFL)
$shell = New-Object -ComObject Shell.Application
foreach ($explorer in @($shell.Windows())) {
  try {
    $handle = [uint32]([int64]$explorer.HWND -band 0xFFFFFFFFL)
    if ($handle -ne $foreground) { continue }
    foreach ($item in @($explorer.Document.SelectedItems())) {
      if ($item -and $item.Path) { [Console]::Out.WriteLine($item.Path) }
    }
    break
  } catch {}
}`;

function execText(run, file, args) {
  return new Promise((resolveText, reject) => {
    run(file, args, {timeout: 2500, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8'}, (error, stdout) => {
      if (error) reject(error);
      else resolveText(String(stdout ?? ''));
    });
  });
}

export function listedPaths(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function macFrontmostBundle(run) {
  const front = String(await execText(run, '/usr/bin/lsappinfo', ['front'])).trim();
  if (!front) return '';
  const info = await execText(run, '/usr/bin/lsappinfo', ['info', '-only', 'bundleid', front]);
  return /"CFBundleIdentifier"="([^"]+)"/.exec(info)?.[1] ?? '';
}

export async function captureFrontmostSelection({platform = process.platform, run = execFile, frontBundle = macFrontmostBundle} = {}) {
  try {
    if (platform === 'darwin') {
      // Avoid the Finder AppleScript (and its 2.5s timeout) on every wake.
      // Most wakes are not over Finder; the lsappinfo preflight costs ~20ms.
      let bundle = null;
      try { bundle = await frontBundle(run); } catch {}
      if (bundle !== null && bundle !== 'com.apple.finder') return [];
      return listedPaths(await execText(run, 'osascript', ['-e', finderScript]));
    }
    if (platform === 'win32') return listedPaths(await execText(run, 'powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', explorerScript]));
    return [];
  } catch {
    return [];
  }
}

export async function regularFiles(paths, {statImpl = stat, limit = 100, platform = process.platform} = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of paths ?? []) {
    if (out.length >= limit) break;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (/::\{[0-9A-Fa-f-]+\}/.test(raw)) continue;
    const path = resolve(raw.trim());
    const key = platform === 'win32' ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const info = await statImpl(path);
      if (info.isFile() && info.size > 0) out.push(path);
    } catch { /* skip missing paths and directories */ }
  }
  return out;
}

export async function frontmostFiles() {
  return regularFiles(await captureFrontmostSelection());
}

// The host compiles Add-Type once. SNAP then reads the foreground hwnd before any window is shown.
// FILES enumerates the saved hwnd and does not call GetForegroundWindow again.
export const selectionHostScript = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GbaForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'SNAP') {
    try {
      $hwnd = [GbaForeground]::GetForegroundWindow()
      $name = 'none'
      if ($hwnd -ne [IntPtr]::Zero) {
        $processId = 0
        [void][GbaForeground]::GetWindowThreadProcessId($hwnd, [ref]$processId)
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName) { $name = $process.ProcessName }
      }
      $value = [uint32]([int64]$hwnd -band 0xFFFFFFFFL)
      [Console]::Out.WriteLine("HWND $value $name")
    } catch {
      [Console]::Out.WriteLine('HWND 0 none')
    }
    [Console]::Out.Flush()
    continue
  }
  if ($line.StartsWith('FILES ')) {
    $want = 0
    [void][uint32]::TryParse($line.Substring(6), [ref]$want)
    if ($want -ne 0) {
      $shell = New-Object -ComObject Shell.Application
      foreach ($explorer in @($shell.Windows())) {
        try {
          $handle = [uint32]([int64]$explorer.HWND -band 0xFFFFFFFFL)
          if ($handle -ne $want) { continue }
          foreach ($item in @($explorer.Document.SelectedItems())) {
            if ($item -and $item.Path) { [Console]::Out.WriteLine($item.Path) }
          }
          break
        } catch {}
      }
    }
    [Console]::Out.WriteLine('END')
    [Console]::Out.Flush()
    continue
  }
  if ($line -eq 'EXIT') { break }
}
`;

export function createSelectionClient({spawnImpl = spawn} = {}) {
  let child = null;
  let buffer = '';
  const lines = [];
  const waiters = [];
  let chain = Promise.resolve();
  function pushLine(line) {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  }
  function takeLine(ms) {
    const pending = lines.length ? Promise.resolve(lines.shift()) : new Promise(resolve => waiters.push(resolve));
    return Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }
  function stop() {
    const current = child;
    child = null;
    try { current?.stdin?.write('EXIT\n'); } catch { /* already closed */ }
    try { current?.kill(); } catch { /* already closed */ }
    while (waiters.length) waiters.shift()(null);
    lines.length = 0;
    buffer = '';
  }
  function bind(current) {
    const decoder = new StringDecoder('utf8');
    current.stdout?.on?.('data', chunk => {
      if (child !== current) return;
      buffer += decoder.write(chunk);
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        pushLine(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    });
    current.on?.('error', () => { if (child === current) stop(); });
    current.on?.('exit', () => { if (child === current) stop(); });
    current.stdin?.on?.('error', () => {});
  }
  async function start() {
    if (child) return;
    const current = spawnImpl('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', selectionHostScript], {stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
    child = current;
    bind(current);
    const line = await takeLine(20000);
    if (line !== 'READY' || child !== current) { stop(); throw new Error('SELECTION_HOST_FAILED'); }
  }
  function enqueue(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }
  function snap() {
    return enqueue(async () => {
      try {
        await start();
        child.stdin.write('SNAP\n');
        const line = await takeLine(2500);
        if (!line) { stop(); return null; }
        const match = /^HWND (\d+) (\S+)$/.exec(line.trim());
        if (!match) return null;
        return {hwnd: match[1], name: match[2].toLowerCase()};
      } catch { stop(); return null; }
    });
  }
  function files(hwnd) {
    return enqueue(async () => {
      if (!/^\d+$/.test(String(hwnd ?? '')) || hwnd === '0') return [];
      try {
        await start();
        child.stdin.write(`FILES ${hwnd}\n`);
        const found = [];
        while (true) {
          const line = await takeLine(2500);
          if (line == null) { stop(); break; }
          if (line === 'END') break;
          if (line.trim()) found.push(line.trim());
        }
        return found;
      } catch { stop(); return []; }
    });
  }
  return {start, snap, files, stop};
}

let sharedClient = null;
function sharedHost() {
  if (!sharedClient) sharedClient = createSelectionClient();
  return sharedClient;
}
export function warmExplorerSelection() {
  if (process.platform !== 'win32') return;
  void sharedHost().start().catch(() => {});
}
export function stopExplorerSelection() {
  sharedClient?.stop();
  sharedClient = null;
}
export function prepareExplorerSelection({client, platform = process.platform} = {}) {
  if (platform !== 'win32') return {hwndReady: Promise.resolve(null), files: async () => []};
  const host = client ?? sharedHost();
  const hwndReady = host.snap().catch(() => null);
  return {
    hwndReady,
    files: async () => {
      const info = await hwndReady;
      if (!info || info.name !== 'explorer' || !info.hwnd || info.hwnd === '0') return [];
      return host.files(info.hwnd).catch(() => []);
    }
  };
}

export const selectionScripts = {finderScript, explorerScript, selectionHostScript};
