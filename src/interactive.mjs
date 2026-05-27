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

export async function runInteractive(initialOpts, intervalSec) {
  const state = {
    all: initialOpts.all,
    nodeOnly: initialOpts.nodeOnly,
    port: initialOpts.port,
    search: '',
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
      state.rows = rows;
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
    // Satır başına 1 satır. Pay: bilgi+başlık+ayraç+sayaç+boş+yardım+durum + 1 güvenlik.
    return Math.max(3, termRows - 8);
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
      return ['', chalk.red.bold(`PID ${r.pid} (${r.info.label}) sonlandırılsın mı?`) + chalk.dim('   [e] evet · [h] hayır')];
    }
    const help = chalk.dim('↑/↓ seç · Enter/d detay · x kill · / ara · a tümü · n node · r yenile · q çık');
    const status = state.lastError ? chalk.red('⚠ ' + state.lastError) : state.status ? chalk.green('✓ ' + state.status) : '';
    return ['', help, status];
  }

  async function killSelected() {
    const r = state.rows[state.selected];
    if (!r || r.pid == null) return;
    try {
      if (os.platform() === 'win32') {
        await execFileP('taskkill', ['/PID', String(r.pid), '/F'], { windowsHide: true });
      } else {
        process.kill(r.pid, 'SIGKILL');
      }
      state.status = `PID ${r.pid} sonlandırıldı.`;
    } catch (err) {
      const msg = (err.stderr || err.message || '').toString().trim();
      state.lastError = `Sonlandırılamadı (PID ${r.pid}): ${msg}`;
    }
    state.mode = 'list';
    await refresh();
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
      if (key.name === 'e') return void killSelected();
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
