// İnteraktif canlı TUI: ok tuşlarıyla satır seçme, detay paneli, süreç sonlandırma,
// canlı arama ve filtre.
//
// Render stratejisi (titreme/hayalet görüntü olmaması için):
//  - Alternatif ekran tamponu (?1049h): kendi temiz ekranı, çıkışta terminal aynen geri gelir.
//  - Satır kaydırma kapalı (?7l): uzun satırlar alt satıra taşmaz, kırpılır.
//  - Her veri satırı TAM OLARAK 1 terminal satırı (sabit genişlik + kırpma) -> viewport
//    matematiği birebir tutar; cli-table3'ün değişken yükseklikli sarması kullanılmaz.
//  - Çizim imleci başa alır, her satırı yazıp satır sonuna kadar siler (\x1b[K),
//    en sonda alt tarafı temizler (\x1b[J). Asla tüm ekranı silip yeniden basmaz.

import os from 'node:os';
import readline from 'node:readline';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';

import { collectRaw } from './collect.mjs';
import { buildPortList } from './identify.mjs';
import { filterRows } from './render.mjs';

const execFileP = promisify(execFile);

const TYPE_COLOR = {
  node: chalk.green,
  system: chalk.gray,
  browser: chalk.blue,
  other: chalk.white,
  unknown: chalk.red,
};

// Sabit sütun genişlikleri (PATH dışında); PATH kalan genişliği alır.
const COL = { sel: 2, port: 6, proto: 5, state: 11, pid: 7, label: 22, project: 18 };

// Nazik kapatmadan sonra zorla sonlandırmaya geçmeden önce beklenecek süre.
const GRACE_MS = 4000;

export async function runInteractive(initialOpts, intervalSec) {
  const state = {
    all: initialOpts.all,
    nodeOnly: initialOpts.nodeOnly,
    port: initialOpts.port,
    search: '',
    sort: 'port', // 'port' | 'pid' | 'project' | 'label' | 'proto'
    rows: [],
    selected: 0,
    offset: 0,
    mode: 'list', // 'list' | 'search' | 'detail' | 'confirmKill'
    status: '',
    lastError: '',
  };
  const intervalMs = Math.max(500, Number(intervalSec) * 1000);
  let busy = false;
  let timer = null;

  enterScreen();
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.stdout.on('resize', draw);

  const keyOf = (r) => `${r.proto}|${r.localPort}|${r.pid}`;

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const prevKey = state.rows[state.selected] ? keyOf(state.rows[state.selected]) : null;
      let rows = filterRows(buildPortList(await collectRaw()), {
        all: state.all,
        nodeOnly: state.nodeOnly,
        port: state.port,
      });
      if (state.search) {
        const q = state.search.toLowerCase();
        rows = rows.filter((r) => searchText(r).includes(q));
      }
      state.rows = sortRows(rows, state.sort);
      if (prevKey) {
        const idx = rows.findIndex((r) => keyOf(r) === prevKey);
        if (idx >= 0) state.selected = idx;
      }
      clampSelection();
      state.lastError = '';
    } catch (err) {
      state.lastError = err.message;
    } finally {
      busy = false;
      draw();
    }
  }

  function clampSelection() {
    if (state.selected >= state.rows.length) state.selected = state.rows.length - 1;
    if (state.selected < 0) state.selected = 0;
  }

  function viewportSize() {
    const termRows = process.stdout.rows || 30;
    // Satır başına 1 satır. Pay: bilgi+başlık+ayraç+sayaç+boş+yardım(2)+durum + 1 güvenlik.
    return Math.max(3, termRows - 9);
  }

  function draw() {
    const lines = [headerLine()];
    if (state.mode === 'detail') {
      lines.push('', ...detailLines(state.rows[state.selected]));
    } else {
      lines.push(...tableLines());
    }
    lines.push(...footerLines());
    renderFrame(lines);
  }

  function headerLine() {
    const filters = [
      state.all ? chalk.yellow('tümü') : 'dinleyen',
      state.nodeOnly ? chalk.green('node') : null,
      state.port != null ? `:${state.port}` : null,
      state.search ? chalk.magenta(`/${state.search}`) : null,
      state.sort !== 'port' ? chalk.dim(`⇅${state.sort}`) : null,
    ]
      .filter(Boolean)
      .join(' ');
    const nodeCount = state.rows.filter((r) => r.info.type === 'node').length;
    return (
      chalk.bold.cyan('● Port Inspector') +
      chalk.dim(`  ${new Date().toLocaleTimeString()} · ${state.rows.length} kayıt · `) +
      chalk.green(`${nodeCount} Node`) +
      (filters ? chalk.dim('  [') + filters + chalk.dim(']') : '')
    );
  }

  function pathWidth() {
    const W = process.stdout.columns || 100;
    const fixed = COL.sel + COL.port + COL.proto + COL.state + COL.pid + COL.label + COL.project;
    const gaps = 7; // 8 sütun arası tek boşluk
    return Math.max(8, W - fixed - gaps - 1);
  }

  function columnHeader() {
    const pw = pathWidth();
    const h = [
      fit('', COL.sel),
      fit('PORT', COL.port),
      fit('PROTO', COL.proto),
      fit('DURUM', COL.state),
      fit('PID', COL.pid),
      fit('SÜREÇ / ARAÇ', COL.label),
      fit('PROJE', COL.project),
      fit('YOL', pw),
    ].join(' ');
    return chalk.bold.cyan(h);
  }

  function tableLines() {
    const size = viewportSize();
    // Seçimi görünür pencerede tut.
    if (state.selected < state.offset) state.offset = state.selected;
    if (state.selected >= state.offset + size) state.offset = state.selected - size + 1;
    if (state.offset < 0) state.offset = 0;

    const out = [columnHeader(), chalk.dim('─'.repeat((process.stdout.columns || 100) - 1))];

    if (state.rows.length === 0) {
      out.push(chalk.dim('  (eşleşen kayıt yok)'));
      return out;
    }

    const pw = pathWidth();
    const slice = state.rows.slice(state.offset, state.offset + size);
    slice.forEach((r, i) => {
      out.push(rowLine(r, state.offset + i === state.selected, pw));
    });

    const counter =
      state.rows.length > size
        ? chalk.dim(`  ${state.selected + 1}/${state.rows.length}   (↑/↓ gezin)`)
        : chalk.dim(`  ${state.rows.length} kayıt`);
    out.push(counter);
    return out;
  }

  function rowLine(r, selected, pw) {
    const project = r.info.project ? r.info.project.name : r.info.type === 'node' ? '?' : '';
    const path = r.info.project?.dir || r.proc?.ExecutablePath || '';
    const cells = [
      selected ? '▶ ' : '  ',
      fit(r.localPort, COL.port),
      fit(r.proto, COL.proto),
      fit(r.state || '—', COL.state),
      fit(r.pid ?? '—', COL.pid),
      fit(r.info.label, COL.label),
      fit(project, COL.project),
      fit(path, pw),
    ];
    if (selected) return chalk.inverse(cells.join(' '));
    const color = TYPE_COLOR[r.info.type] || chalk.white;
    return [
      cells[0],
      chalk.bold(cells[1]),
      cells[2],
      colorState(cells[3], r.state),
      chalk.dim(cells[4]),
      color(cells[5]),
      cells[6],
      chalk.dim(cells[7]),
    ].join(' ');
  }

  function detailLines(r) {
    if (!r) return [chalk.dim('  (seçili kayıt yok)')];
    const W = (process.stdout.columns || 100) - 1;
    const L = (k, v) => '  ' + chalk.cyan((k + ':').padEnd(14)) + ' ' + (v ?? chalk.dim('—'));
    const cmd = r.proc?.CommandLine || '—';
    const out = [
      chalk.bold.underline('Detay'),
      L('Port', `${chalk.bold(r.localPort)}  (${r.proto} ${r.state || ''})`),
      L('Adres', r.localAddress),
      L('Uzak uç', r.remote),
      L('PID', r.pid),
      L('Tür', r.info.label),
      L('Proje', r.info.project ? `${r.info.project.name}  —  ${r.info.project.dir}` : null),
      L('Çalıştırılan', r.proc?.ExecutablePath),
      L('Başlangıç', r.proc?.StartTime),
      '',
      chalk.cyan('  Komut satırı:'),
    ];
    // Komut satırını ekran genişliğine göre satırlara böl (her biri tek satır).
    for (let i = 0; i < cmd.length && i < W * 6; i += W - 2) {
      out.push('  ' + chalk.dim(cmd.slice(i, i + W - 2)));
    }
    return out;
  }

  function footerLines() {
    if (state.mode === 'search') {
      return ['', chalk.magenta('Ara: ') + state.search + chalk.inverse(' ') + chalk.dim('   (Enter onayla · Esc temizle)')];
    }
    if (state.mode === 'confirmKill') {
      const r = state.rows[state.selected];
      return [
        '',
        chalk.red.bold(`PID ${r.pid} (${r.info.label}) sonlandırılsın mı?`) +
          chalk.dim('   [e] nazik (TERM→KILL) · [f] zorla · [h] iptal'),
      ];
    }
    const help1 = chalk.dim('↑/↓ seç · Enter/d detay · / ara · a tümü · n node · s sırala · r yenile · q çık');
    const help2 = chalk.dim('x kill · o klasörü aç · e editörde aç · c komutu kopyala');
    const status = state.lastError ? chalk.red('⚠ ' + state.lastError) : state.status ? chalk.green('✓ ' + state.status) : '';
    return ['', help1, help2, status];
  }

  // force=false: nazik kapatma (TERM). force=true: zorla (KILL).
  async function killSelected(force) {
    const r = state.rows[state.selected];
    if (!r || r.pid == null) return;
    const pid = r.pid;
    state.mode = 'list';
    try {
      await killProcess(pid, force);
      state.status = force
        ? `PID ${pid} zorla sonlandırıldı.`
        : `PID ${pid} kapatma sinyali gönderildi (TERM).`;
    } catch (err) {
      const msg = (err.stderr || err.message || '').toString().trim();
      state.lastError = `Sonlandırılamadı (PID ${pid}): ${msg}`;
    }
    await refresh();
    // Nazik kapatmada süreç yanıt vermezse bir süre sonra zorla sonlandır.
    if (!force) scheduleEscalation(pid);
  }

  function scheduleEscalation(pid) {
    setTimeout(async () => {
      if (!isAlive(pid)) return; // nazikçe kapanmış, dokunma.
      try {
        await killProcess(pid, true);
        state.status = `PID ${pid} yanıt vermedi, zorla sonlandırıldı.`;
      } catch {
        /* zaten kapanmış olabilir */
      }
      refresh();
    }, GRACE_MS);
  }

  async function openFolder() {
    const dir = targetDir(state.rows[state.selected]);
    if (!dir) return void setError('Açılacak klasör bulunamadı.');
    try {
      const plat = os.platform();
      if (plat === 'win32') {
        // explorer başarıda bile 1 döndürebilir; hatayı yok say.
        execFile('explorer', [dir], { windowsHide: true });
      } else {
        await execFileP(plat === 'darwin' ? 'open' : 'xdg-open', [dir]);
      }
      setStatus(`Klasör açıldı: ${dir}`);
    } catch (err) {
      setError('Klasör açılamadı: ' + (err.message || ''));
    }
  }

  async function openEditor() {
    const dir = targetDir(state.rows[state.selected]);
    if (!dir) return void setError('Açılacak klasör bulunamadı.');
    const win = os.platform() === 'win32';
    const candidates = [
      ['code', [dir]],
      ...(process.env.VISUAL ? [[process.env.VISUAL, [dir]]] : []),
      ...(process.env.EDITOR ? [[process.env.EDITOR, [dir]]] : []),
    ];
    for (const [cmd, args] of candidates) {
      try {
        await execFileP(cmd, args, { windowsHide: true, shell: win });
        return void setStatus(`Editörde açıldı: ${dir}`);
      } catch {
        /* sıradakini dene */
      }
    }
    setError('Editör bulunamadı (code / $EDITOR ayarlı değil).');
  }

  async function copyCommand() {
    const r = state.rows[state.selected];
    const text = r?.proc?.CommandLine || r?.proc?.ExecutablePath || '';
    if (!text) return void setError('Kopyalanacak komut yok.');
    try {
      await copyToClipboard(text);
      setStatus('Komut satırı panoya kopyalandı.');
    } catch (err) {
      setError('Panoya kopyalanamadı: ' + (err.message || ''));
    }
  }

  function setStatus(msg) {
    state.status = msg;
    state.lastError = '';
    draw();
  }
  function setError(msg) {
    state.lastError = msg;
    state.status = '';
    draw();
  }
  function cycleSort() {
    const order = ['port', 'pid', 'project', 'label', 'proto'];
    const selKey = state.rows[state.selected] ? keyOf(state.rows[state.selected]) : null;
    state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
    state.rows = sortRows(state.rows, state.sort);
    if (selKey) {
      const idx = state.rows.findIndex((r) => keyOf(r) === selKey);
      if (idx >= 0) state.selected = idx;
    }
    setStatus(`Sıralama: ${state.sort}`);
  }

  function onKey(str, key) {
    if (!key) return;

    if (state.mode === 'search') {
      if (key.name === 'return') { state.mode = 'list'; refresh(); return; }
      if (key.name === 'escape') { state.search = ''; state.mode = 'list'; refresh(); return; }
      if (key.name === 'backspace') { state.search = state.search.slice(0, -1); draw(); return; }
      if (str && !key.ctrl && !key.meta && str.length === 1) { state.search += str; draw(); }
      return;
    }

    if (state.mode === 'confirmKill') {
      if (key.name === 'e') return void killSelected(false);
      if (key.name === 'f') return void killSelected(true);
      if (key.name === 'h' || key.name === 'escape') { state.mode = 'list'; draw(); }
      return;
    }

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();
    if (key.name === 'up' || key.name === 'k') return move(-1);
    if (key.name === 'down' || key.name === 'j') return move(1);
    if (key.name === 'pageup') return move(-viewportSize());
    if (key.name === 'pagedown') return move(viewportSize());
    if (key.name === 'home') { state.selected = 0; draw(); return; }
    if (key.name === 'end') { state.selected = state.rows.length - 1; draw(); return; }
    if (key.name === 'return' || key.name === 'd') { state.mode = state.mode === 'detail' ? 'list' : 'detail'; draw(); return; }
    if (key.name === 'escape' && state.mode === 'detail') { state.mode = 'list'; draw(); return; }
    if (str === '/') { state.mode = 'search'; draw(); return; }
    if (str === 'x' || key.name === 'delete') {
      if (state.rows[state.selected]?.pid != null) { state.mode = 'confirmKill'; draw(); }
      return;
    }
    if (key.name === 'a') { state.all = !state.all; refresh(); return; }
    if (key.name === 'n') { state.nodeOnly = !state.nodeOnly; refresh(); return; }
    if (str === 's') return void cycleSort();
    if (str === 'o') return void openFolder();
    if (str === 'e') return void openEditor();
    if (str === 'c') return void copyCommand();
    if (key.name === 'r') return void refresh();
  }

  function move(delta) {
    state.selected += delta;
    clampSelection();
    state.status = '';
    draw();
  }

  function quit() {
    if (timer) clearInterval(timer);
    process.stdout.removeListener('resize', draw);
    exitScreen();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    console.log(chalk.dim('Port Inspector kapatıldı.'));
    process.exit(0);
  }

  await refresh();
  timer = setInterval(refresh, intervalMs);
}

/* ----------------------------- yardımcılar ------------------------------ */

// Bir süreci sonlandırır. force=false -> nazik (SIGTERM / taskkill), force=true -> zorla (SIGKILL / taskkill /F).
async function killProcess(pid, force) {
  if (os.platform() === 'win32') {
    const args = ['/PID', String(pid), '/T']; // /T: alt süreçleri de dahil et
    if (force) args.push('/F');
    await execFileP('taskkill', args, { windowsHide: true });
  } else {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  }
}

// Sürecin hâlâ yaşadığını çapraz platform kontrol eder (sinyal 0).
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // var ama sinyal gönderme yetkisi yok
  }
}

// Seçili satırın açılabilir hedef dizinini döndürür: proje kökü ya da çalıştırılabilirin klasörü.
function targetDir(r) {
  if (!r) return null;
  if (r.info.project?.dir) return r.info.project.dir;
  if (r.proc?.ExecutablePath) return dirname(r.proc.ExecutablePath);
  return null;
}

// Metni işletim sistemi panosuna kopyalar (stdin üzerinden besler).
function copyToClipboard(text) {
  const plat = os.platform();
  const chain =
    plat === 'win32'
      ? [['clip', []]]
      : plat === 'darwin'
        ? [['pbcopy', []]]
        : [
            ['xclip', ['-selection', 'clipboard']],
            ['wl-copy', []],
          ];
  const tryCmd = ([cmd, args]) =>
    new Promise((resolve, reject) => {
      const child = execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
      child.stdin.on('error', reject);
      child.stdin.end(text);
    });
  // Linux'ta xclip yoksa wl-copy'yi dene.
  return chain.reduce(
    (p, entry) => p.catch(() => tryCmd(entry)),
    Promise.reject(new Error('init'))
  );
}

// Satırları seçili anahtara göre sıralar (kararlı kopya döndürür).
function sortRows(rows, key) {
  const proj = (r) => (r.info.project?.name || (r.info.type === 'node' ? '~' : '')).toLowerCase();
  const byPort = (a, b) => a.localPort - b.localPort || a.proto.localeCompare(b.proto);
  const cmp = {
    port: byPort,
    pid: (a, b) => (a.pid ?? 0) - (b.pid ?? 0) || byPort(a, b),
    project: (a, b) => proj(a).localeCompare(proj(b)) || byPort(a, b),
    label: (a, b) => a.info.label.localeCompare(b.info.label) || byPort(a, b),
    proto: (a, b) => a.proto.localeCompare(b.proto) || byPort(a, b),
  }[key];
  return [...rows].sort(cmp || byPort);
}

// Metni tam olarak `width` görünür karaktere getirir: uzunsa '…' ile kırpar, kısaysa boşlukla doldurur.
function fit(s, width) {
  s = String(s ?? '');
  if (s.length > width) return width > 1 ? s.slice(0, width - 1) + '…' : s.slice(0, width);
  return s.padEnd(width);
}

// Çerçeveyi çizer: başa git, her satırı satır-sonuna-kadar silerek yaz, sonda altı temizle.
function renderFrame(lines) {
  const frame = '\x1b[H' + lines.join('\x1b[K\r\n') + '\x1b[K\x1b[J';
  process.stdout.write(frame);
}

function enterScreen() {
  process.stdout.write('\x1b[?1049h'); // alternatif ekran tamponu
  process.stdout.write('\x1b[?25l'); // imleci gizle
  process.stdout.write('\x1b[?7l'); // satır kaydırmayı kapat
  process.stdout.write('\x1b[2J\x1b[H'); // temizle + başa al
}

function exitScreen() {
  process.stdout.write('\x1b[?7h'); // satır kaydırmayı geri aç
  process.stdout.write('\x1b[?25h'); // imleci geri getir
  process.stdout.write('\x1b[?1049l'); // ana ekrana dön
}

function colorState(padded, raw) {
  if (raw === 'Listen') return chalk.green(padded);
  if (raw === 'Established') return chalk.yellow(padded);
  return chalk.dim(padded);
}

function searchText(r) {
  return [
    r.localPort, r.proto, r.state, r.pid, r.info.label,
    r.info.project?.name, r.info.project?.dir, r.proc?.ExecutablePath, r.proc?.CommandLine,
  ]
    .join(' ')
    .toLowerCase();
}
