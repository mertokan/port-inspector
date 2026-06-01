// Ham veriyi işler: portları süreçlerle eşler, süreç türünü sınıflandırır,
// Node süreçleri için hangi proje/araç olduğunu çözer. Çapraz platform.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, basename, join, parse as parsePath } from 'node:path';

// Bilinen geliştirme araçları: komut satırında bunları görürsek etiketleriz.
// Sıra önemlidir — ilk eşleşen kazanır, bu yüzden özel olanlar önce gelir.
const DEV_TOOLS = [
  // Framework / meta-framework dev sunucuları
  ['react-scripts', 'CRA (react-scripts)'],
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['vite', 'Vite'],
  ['@nestjs', 'NestJS'],
  ['nest start', 'NestJS'],
  ['ng serve', 'Angular CLI'],
  ['@angular', 'Angular CLI'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['sveltekit', 'SvelteKit'],
  ['astro', 'Astro'],
  ['remix', 'Remix'],
  ['gatsby', 'Gatsby'],
  ['quasar', 'Quasar'],
  ['@ionic', 'Ionic'],
  // Mobil / masaüstü
  ['expo', 'Expo'],
  ['react-native', 'React Native (Metro)'],
  ['metro', 'Metro'],
  ['electron', 'Electron'],
  // CMS / backend platformları
  ['strapi', 'Strapi'],
  ['@medusajs', 'Medusa'],
  ['medusa', 'Medusa'],
  ['payload', 'Payload'],
  ['supabase', 'Supabase'],
  // Web3
  ['hardhat', 'Hardhat'],
  ['truffle', 'Truffle'],
  ['ganache', 'Ganache'],
  // ORM / veritabanı / araç
  ['prisma', 'Prisma'],
  ['drizzle-kit', 'Drizzle'],
  ['drizzle', 'Drizzle'],
  ['tailwindcss', 'Tailwind'],
  ['storybook', 'Storybook'],
  // HTTP sunucu kütüphaneleri / GraphQL
  ['fastify', 'Fastify'],
  ['@hono', 'Hono'],
  ['koa', 'Koa'],
  ['apollo', 'Apollo'],
  ['graphql', 'GraphQL'],
  // Statik / basit sunucular
  ['json-server', 'json-server'],
  ['http-server', 'http-server'],
  ['live-server', 'live-server'],
  ['browser-sync', 'BrowserSync'],
  ['serve', 'serve'],
  // Paketleyici / bundler
  ['parcel', 'Parcel'],
  ['esbuild', 'esbuild'],
  ['rollup', 'Rollup'],
  ['turbo', 'Turborepo'],
  ['webpack-dev-server', 'webpack-dev-server'],
  ['webpack', 'webpack'],
  // Çalıştırıcı / izleyici / süreç yöneticisi
  ['nodemon', 'nodemon'],
  ['ts-node-dev', 'ts-node-dev'],
  ['ts-node', 'ts-node'],
  ['tsx', 'tsx'],
  ['pm2', 'PM2'],
  // Test koşucuları
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['playwright', 'Playwright'],
  ['cypress', 'Cypress'],
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

// Bir dizinde package.json olup olmadığını (ve proje adını) okur — sonucu önbelleğe alır.
// İnteraktif mod saniyede bir yenilediğinden, aynı dizin ağaçlarını tekrar tekrar
// fs ile yürümek pahalıdır; oturum boyunca projeler nadiren değiştiği için cache güvenli.
const pkgDirCache = new Map(); // dir -> { dir, name } | null (null = burada package.json yok)

function readPkgAt(dir) {
  if (pkgDirCache.has(dir)) return pkgDirCache.get(dir);
  let result = null;
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      result = { dir, name: pkg.name || basename(dir) };
    } catch {
      result = { dir, name: basename(dir) };
    }
  }
  pkgDirCache.set(dir, result);
  return result;
}

// Testler için: proje önbelleğini temizler.
export function _clearProjectCache() {
  pkgDirCache.clear();
}

// Bir yoldan yukarı yürüyerek node_modules dışındaki gerçek proje kökünü bulur.
export function findProject(startPath) {
  if (!startPath) return null;
  let dir = isDirSafe(startPath) ? startPath : dirname(startPath);
  const root = parsePath(dir).root;
  while (dir && dir !== root) {
    if (isInsideNodeModules(dir)) {
      dir = dirname(dir);
      continue;
    }
    const found = readPkgAt(dir);
    if (found) return found;
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
export function classify(proc) {
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
