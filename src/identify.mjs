// Ham veriyi işler: portları süreçlerle eşler, süreç türünü sınıflandırır,
// Node süreçleri için hangi proje/araç olduğunu çözer. Çapraz platform.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, basename, join, parse as parsePath } from 'node:path';

// Bilinen geliştirme araçları: komut satırında bunları görürsek etiketleriz.
const DEV_TOOLS = [
  ['vite', 'Vite'],
  ['next', 'Next.js'],
  ['react-scripts', 'CRA (react-scripts)'],
  ['nuxt', 'Nuxt'],
  ['@nestjs', 'NestJS'],
  ['nest', 'NestJS'],
  ['nodemon', 'nodemon'],
  ['ts-node', 'ts-node'],
  ['tsx', 'tsx'],
  ['webpack', 'webpack'],
  ['ng serve', 'Angular CLI'],
  ['@angular', 'Angular CLI'],
  ['astro', 'Astro'],
  ['remix', 'Remix'],
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['storybook', 'Storybook'],
  ['expo', 'Expo'],
  ['electron', 'Electron'],
];

const RUNTIMES = ['node', 'bun', 'deno'];

function runtimeName(proc) {
  const name = (proc.Name || '').toLowerCase().replace(/\.exe$/, '');
  if (RUNTIMES.includes(name)) return name;
  const exe = (proc.ExecutablePath || '').toLowerCase().replace(/\.exe$/, '');
  const base = exe.split(/[\\/]/).pop();
  if (RUNTIMES.includes(base)) return base;
  return null;
}

// Komut satırını argümanlara böler (tırnakları dikkate alır).
function splitArgs(cmd) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

function isInsideNodeModules(p) {
  return /[\\/]node_modules([\\/]|$)/i.test(p);
}

function isDirSafe(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Bir yoldan yukarı yürüyerek node_modules dışındaki gerçek proje kökünü bulur.
function findProject(startPath) {
  if (!startPath) return null;
  let dir = isDirSafe(startPath) ? startPath : dirname(startPath);
  const root = parsePath(dir).root;
  while (dir && dir !== root) {
    if (isInsideNodeModules(dir)) {
      dir = dirname(dir);
      continue;
    }
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return { dir, name: pkg.name || basename(dir) };
      } catch {
        return { dir, name: basename(dir) };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Komut satırından çalıştırılan script yolunu çıkarmaya çalışır.
function scriptPathFromArgs(args) {
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) continue;
    if (/\.(c|m)?[jt]s$/i.test(a)) return a;
    if (a.includes('\\') || a.includes('/')) return a;
  }
  return null;
}

const SYSTEM_NAMES = new Set([
  // Windows
  'svchost', 'system', 'lsass', 'services', 'wininit', 'spoolsv', 'csrss', 'smss',
  'msmpeng', 'searchindexer', 'dns',
  // Unix
  'systemd', 'init', 'launchd', 'rpcbind', 'avahi-daemon', 'cupsd', 'dnsmasq',
]);

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'safari', 'firefox-bin'];

/**
 * Bir süreci sınıflandırır: { type, label, project }
 * type: 'node' | 'system' | 'browser' | 'other' | 'unknown'
 */
function classify(proc) {
  if (!proc) return { type: 'unknown', label: '? (süreç bilgisi yok)', project: null };

  const rawName = (proc.Name || 'bilinmiyor').replace(/\.exe$/i, '');
  const cmd = proc.CommandLine || '';
  const cmdLower = cmd.toLowerCase();

  const runtime = runtimeName(proc);
  if (runtime) {
    let tool = null;
    for (const [needle, pretty] of DEV_TOOLS) {
      if (cmdLower.includes(needle)) { tool = pretty; break; }
    }
    const args = splitArgs(cmd);
    const script = scriptPathFromArgs(args);
    // Gerçek çalışma dizini (Unix'te /proc/cwd) en güveniliridir; yoksa script/exe yolundan türet.
    const project = findProject(proc.Cwd || script || proc.ExecutablePath);
    let label = runtime;
    if (tool) label += ` · ${tool}`;
    else if (script) label += ` · ${basename(script)}`;
    return { type: 'node', label, project };
  }

  const lower = rawName.toLowerCase();
  if (SYSTEM_NAMES.has(lower)) return { type: 'system', label: `${rawName} (sistem)`, project: null };
  if (BROWSERS.includes(lower)) return { type: 'browser', label: `${rawName} (tarayıcı)`, project: null };
  return { type: 'other', label: rawName, project: null };
}

/**
 * Ham veriyi alıp port bazlı, zenginleştirilmiş listeye dönüştürür.
 */
export function buildPortList(raw) {
  const procById = new Map();
  for (const p of raw.procs) procById.set(p.ProcessId, p);

  const rows = [];

  for (const c of raw.tcp) {
    const proc = procById.get(c.OwningProcess) || null;
    rows.push({
      proto: 'TCP',
      localAddress: c.LocalAddress,
      localPort: Number(c.LocalPort),
      remote: c.RemoteAddress && c.RemotePort ? `${c.RemoteAddress}:${c.RemotePort}` : null,
      state: c.State || '',
      pid: c.OwningProcess ?? null,
      proc,
      info: classify(proc),
    });
  }

  for (const u of raw.udp) {
    const proc = procById.get(u.OwningProcess) || null;
    rows.push({
      proto: 'UDP',
      localAddress: u.LocalAddress,
      localPort: Number(u.LocalPort),
      remote: null,
      state: '',
      pid: u.OwningProcess ?? null,
      proc,
      info: classify(proc),
    });
  }

  return rows;
}
