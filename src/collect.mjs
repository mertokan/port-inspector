// Açık/dinlenen portları ve süreçleri YAPISAL olarak toplar — çapraz platform.
//   Windows : PowerShell cmdlet'leri (Get-NetTCPConnection / Win32_Process) -> JSON
//   macOS   : lsof + ps + lsof(cwd)
//   Linux   : lsof + /proc/<pid>/{cmdline,exe,cwd}
// Tüm platformlar aynı normalize şekli döndürür:
//   { tcp:[{LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State}],
//     udp:[{LocalAddress,LocalPort,OwningProcess}],
//     procs:[{ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,StartTime,Cwd}] }

import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readlink } from 'node:fs/promises';

const execFileP = promisify(execFile);

export async function collectRaw() {
  switch (os.platform()) {
    case 'win32':
      return collectWindows();
    default:
      return collectUnix(); // linux, darwin (macOS), ve diğer POSIX
  }
}

/* ------------------------------- Windows -------------------------------- */

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$tcp = Get-NetTCPConnection | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess, @{N='State';E={ $_.State.ToString() }}
$udp = Get-NetUDPEndpoint | Select-Object LocalAddress, LocalPort, OwningProcess
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, @{N='StartTime';E={ if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { $null } }}
[pscustomobject]@{ tcp = @($tcp); udp = @($udp); procs = @($procs) } | ConvertTo-Json -Depth 4 -Compress
`;

let cachedShell = null;

async function resolveShell() {
  if (cachedShell) return cachedShell;
  for (const candidate of ['pwsh', 'powershell']) {
    try {
      await execFileP(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
      cachedShell = candidate;
      return candidate;
    } catch {
      /* sıradakini dene */
    }
  }
  throw new Error('PowerShell bulunamadı (pwsh veya powershell.exe gerekli).');
}

async function collectWindows() {
  const shell = await resolveShell();
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64'); // -EncodedCommand: escape derdi yok
  const { stdout } = await execFileP(
    shell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  );
  const data = JSON.parse(stdout);
  const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const norm = (p) => ({ ...p, Cwd: null });
  return { tcp: arr(data.tcp), udp: arr(data.udp), procs: arr(data.procs).map(norm) };
}

/* --------------------------- macOS / Linux ------------------------------ */

async function collectUnix() {
  let stdout;
  try {
    // -F: makine-okur alan biçimi. p=pid c=komut(kısa) f=fd t=tür P=protokol n=ad T=durum
    ({ stdout } = await execFileP('lsof', ['-nP', '-i', '-FpcftPnT'], {
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error("Bu platformda port taraması için 'lsof' gerekli. Kurulum: (Debian/Ubuntu) sudo apt install lsof · (macOS) önyüklü gelir.");
    }
    // lsof bazı soketlere erişemezse 1 döndürür ama yine de çıktı verir.
    stdout = err.stdout || '';
    if (!stdout) throw err;
  }

  const tcp = [];
  const udp = [];
  const pids = new Set();

  let pid = null;
  let cmd = null;
  let cur = null; // o anki dosya (soket) kaydı

  const flush = () => {
    if (!cur || !cur.proto || !cur.name) return;
    const { local, remote } = parseAddr(cur.name);
    if (!local) return;
    pids.add(pid);
    if (cur.proto === 'TCP') {
      tcp.push({
        LocalAddress: local.addr,
        LocalPort: local.port,
        RemoteAddress: remote?.addr ?? '',
        RemotePort: remote?.port ?? 0,
        OwningProcess: pid,
        State: normalizeState(cur.state),
      });
    } else if (cur.proto === 'UDP') {
      udp.push({ LocalAddress: local.addr, LocalPort: local.port, OwningProcess: pid });
    }
    cur = null;
  };

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    switch (tag) {
      case 'p': flush(); pid = Number(val); cmd = null; cur = null; break;
      case 'c': cmd = val; break;
      case 'f': flush(); cur = { proto: null, name: null, state: null }; break; // yeni dosya kaydı
      case 'P': if (cur) cur.proto = val.toUpperCase(); break;
      case 'n': if (cur) cur.name = val; break;
      case 'T': if (cur && val.startsWith('ST=')) cur.state = val.slice(3); break;
      default: break;
    }
  }
  flush();

  const procs = await enrichProcs([...pids]);
  return { tcp, udp, procs };
}

// lsof "n" alanını ayrıştırır: "*:8080", "127.0.0.1:3000", "[::1]:443->[::1]:51000"
function parseAddr(name) {
  const [localStr, remoteStr] = name.split('->');
  return { local: splitHostPort(localStr), remote: remoteStr ? splitHostPort(remoteStr) : null };
}

function splitHostPort(s) {
  if (!s) return null;
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  let addr = s.slice(0, i).replace(/^\[|\]$/g, '');
  if (addr === '*' || addr === '') addr = '0.0.0.0';
  const port = Number(s.slice(i + 1));
  if (!Number.isFinite(port)) return null;
  return { addr, port };
}

function normalizeState(s) {
  if (!s) return ''; // UDP veya durumsuz
  if (/^LISTEN$/i.test(s)) return 'Listen';
  if (/^ESTABLISHED$/i.test(s)) return 'Established';
  return s;
}

// Her PID için tam komut satırı, çalıştırılabilir ve çalışma dizinini doldurur.
async function enrichProcs(pids) {
  const isLinux = os.platform() === 'linux';
  const results = await Promise.all(
    pids.map((pid) => (isLinux ? enrichLinux(pid) : enrichMac(pid)))
  );
  return results.filter(Boolean);
}

async function enrichLinux(pid) {
  const base = `/proc/${pid}`;
  const out = {
    ProcessId: pid, ParentProcessId: null, Name: null,
    ExecutablePath: null, CommandLine: null, StartTime: null, Cwd: null,
  };
  try {
    const raw = await readFile(`${base}/cmdline`);
    out.CommandLine = raw.toString('utf8').replace(/\0/g, ' ').trim();
  } catch { /* yetki yok olabilir */ }
  try { out.Cwd = await readlink(`${base}/cwd`); } catch {}
  try { out.ExecutablePath = await readlink(`${base}/exe`); } catch {}
  try {
    out.Name = (await readFile(`${base}/comm`, 'utf8')).trim();
  } catch {
    out.Name = out.ExecutablePath ? out.ExecutablePath.split('/').pop() : `pid:${pid}`;
  }
  return out;
}

async function enrichMac(pid) {
  const out = {
    ProcessId: pid, ParentProcessId: null, Name: null,
    ExecutablePath: null, CommandLine: null, StartTime: null, Cwd: null,
  };
  try {
    const { stdout } = await execFileP('ps', ['-p', String(pid), '-o', 'comm=,command=']);
    const line = stdout.trim();
    const sp = line.indexOf(' ');
    out.ExecutablePath = sp > 0 ? line.slice(0, sp) : line;
    out.CommandLine = sp > 0 ? line.slice(sp + 1) : line;
    out.Name = out.ExecutablePath.split('/').pop();
  } catch { return null; }
  try {
    const { stdout } = await execFileP('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const m = stdout.split('\n').find((l) => l.startsWith('n'));
    if (m) out.Cwd = m.slice(1);
  } catch {}
  return out;
}
