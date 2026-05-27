// İnteraktif canlı TUI: ok tuşlarıyla satır seçme, detay paneli, süreç sonlandırma,
// canlı arama ve filtre. Bağımlılık-hafif (chalk + cli-table3 + ANSI) yaklaşımı.

import os from 'node:os';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import Table from 'cli-table3';

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

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l'); // imleci gizle

  process.stdin.on('keypress', (str, key) => onKey(str, key));

  function keyOf(r) {
    return `${r.proto}|${r.localPort}|${r.pid}`;
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const prevKey = state.rows[state.selected] ? keyOf(state.rows[state.selected]) : null;
      const raw = await collectRaw();
      let rows = filterRows(buildPortList(raw), {
        all: state.all,
        nodeOnly: state.nodeOnly,
        port: state.port,
      });
      if (state.search) {
        const q = state.search.toLowerCase();
        rows = rows.filter((r) => searchText(r).includes(q));
      }
      state.rows = rows;
      // Seçimi mümkünse aynı sürecin üzerinde tut.
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
    // Başlık/altbilgi/kenarlık için pay bırak; her satır cli-table3'te 2 satır yer kaplar.
    const termRows = process.stdout.rows || 30;
    const reserved = 12;
    return Math.max(3, Math.floor((termRows - reserved) / 2));
  }

  function draw() {
    const out = [];
    out.push(headerLine());

    if (state.mode === 'detail') {
      out.push(detailPanel(state.rows[state.selected]));
    } else {
      out.push(tableView());
    }
    out.push(footer());
    process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
  }

  function headerLine() {
    const filters = [
      state.all ? chalk.yellow('tümü') : 'sadece-dinleyen',
      state.nodeOnly ? chalk.green('sadece-node') : null,
      state.port != null ? `port=${state.port}` : null,
      state.search ? chalk.magenta(`ara:"${state.search}"`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const nodeCount = state.rows.filter((r) => r.info.type === 'node').length;
    return (
      chalk.bold.cyan('● Port Inspector') +
      chalk.dim(`  ${new Date().toLocaleTimeString()} · her ${intervalSec}s · `) +
      chalk.dim(`${state.rows.length} kayıt, `) +
      chalk.green(`${nodeCount} Node`) +
      (filters ? chalk.dim('  [' + filters + ']') : '')
    );
  }

  function tableView() {
    const size = viewportSize();
    // Seçili satırı görünür pencerede tut.
    if (state.selected < state.offset) state.offset = state.selected;
    if (state.selected >= state.offset + size) state.offset = state.selected - size + 1;
    if (state.offset < 0) state.offset = 0;

    const table = new Table({
      head: ['', 'PORT', 'PROTO', 'DURUM', 'PID', 'SÜREÇ / ARAÇ', 'PROJE', 'YOL'].map((h) =>
        chalk.bold.cyan(h)
      ),
      style: { head: [], border: [] },
      colWidths: [3, 7, 7, 11, 8, 24, 22, 34],
      wordWrap: true,
    });

    const slice = state.rows.slice(state.offset, state.offset + size);
    slice.forEach((r, i) => {
      const idx = state.offset + i;
      const isSel = idx === state.selected;
      const color = TYPE_COLOR[r.info.type] || chalk.white;
      const project = r.info.project ? r.info.project.name : r.info.type === 'node' ? '?' : '';
      const path = r.info.project?.dir || r.proc?.ExecutablePath || '';
      const cells = [
        isSel ? chalk.cyan('▶') : ' ',
        String(r.localPort),
        r.proto,
        r.state || '—',
        r.pid ?? '—',
        r.info.label,
        project,
        path,
      ];
      table.push(isSel ? cells.map((c) => chalk.inverse(c)) : styleRow(cells, color, r));
    });

    if (state.rows.length === 0) return chalk.dim('  (eşleşen kayıt yok)');

    let view = table.toString();
    if (state.rows.length > size) {
      view += '\n' + chalk.dim(`  ${state.selected + 1}/${state.rows.length}  (↑/↓ gezin)`);
    }
    return view;
  }

  function styleRow(cells, color, r) {
    return [
      cells[0],
      chalk.bold(cells[1]),
      cells[2],
      colorState(r.state),
      chalk.dim(String(cells[4])),
      color(cells[5]),
      cells[6],
      chalk.dim(cells[7]),
    ];
  }

  function detailPanel(r) {
    if (!r) return chalk.dim('  (seçili kayıt yok)');
    const L = (k, v) => `  ${chalk.cyan(k.padEnd(14))} ${v ?? chalk.dim('—')}`;
    return [
      chalk.bold.underline('Detay'),
      L('Port', chalk.bold(r.localPort) + `  (${r.proto} ${r.state || ''})`),
      L('Adres', r.localAddress),
      L('Uzak uç', r.remote),
      L('PID', r.pid),
      L('Tür', r.info.label),
      L('Proje', r.info.project ? `${r.info.project.name}  —  ${r.info.project.dir}` : null),
      L('Çalıştırılan', r.proc?.ExecutablePath),
      L('Başlangıç', r.proc?.StartTime),
      '',
      chalk.cyan('  Komut satırı:'),
      '  ' + chalk.dim(wrap(r.proc?.CommandLine || '—', (process.stdout.columns || 100) - 4)),
      '',
      chalk.dim('  [Esc/d] geri  [x] bu süreci sonlandır'),
    ].join('\n');
  }

  function footer() {
    if (state.mode === 'search') {
      return '\n' + chalk.magenta('Ara: ') + state.search + chalk.inverse(' ') +
        chalk.dim('   (Enter onayla · Esc temizle)');
    }
    if (state.mode === 'confirmKill') {
      const r = state.rows[state.selected];
      return '\n' + chalk.red.bold(`PID ${r.pid} (${r.info.label}) sonlandırılsın mı?`) +
        chalk.dim('  [e] evet · [h] hayır');
    }
    const status = state.lastError
      ? chalk.red('⚠ ' + state.lastError)
      : state.status
        ? chalk.green(state.status)
        : '';
    const help = chalk.dim(
      '↑/↓ seç · [Enter/d] detay · [x] kill · [/] ara · [a] tümü · [n] node · [r] yenile · [q] çık'
    );
    return '\n' + help + (status ? '\n' + status : '');
  }

  async function killSelected() {
    const r = state.rows[state.selected];
    if (!r || r.pid == null) return;
    try {
      if (os.platform() === 'win32') {
        await execFileP('taskkill', ['/PID', String(r.pid), '/F'], { windowsHide: true });
      } else {
        process.kill(r.pid, 'SIGKILL'); // Unix: doğrudan sinyal
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

    // Arama modu: metin girişi
    if (state.mode === 'search') {
      if (key.name === 'return') { state.mode = 'list'; refresh(); return; }
      if (key.name === 'escape') { state.search = ''; state.mode = 'list'; refresh(); return; }
      if (key.name === 'backspace') { state.search = state.search.slice(0, -1); draw(); return; }
      if (str && !key.ctrl && !key.meta && str.length === 1) { state.search += str; draw(); }
      return;
    }

    // Kill onayı
    if (state.mode === 'confirmKill') {
      if (key.name === 'e') return void killSelected();
      if (key.name === 'h' || key.name === 'escape') { state.mode = 'list'; draw(); }
      return;
    }

    // Genel
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return quit();
    if (key.name === 'up' || key.name === 'k') { move(-1); return; }
    if (key.name === 'down' || key.name === 'j') { move(1); return; }
    if (key.name === 'pageup') { move(-viewportSize()); return; }
    if (key.name === 'pagedown') { move(viewportSize()); return; }
    if (key.name === 'home') { state.selected = 0; draw(); return; }
    if (key.name === 'end') { state.selected = state.rows.length - 1; draw(); return; }

    if (key.name === 'return' || key.name === 'd') {
      state.mode = state.mode === 'detail' ? 'list' : 'detail';
      draw();
      return;
    }
    if (key.name === 'escape' && state.mode === 'detail') { state.mode = 'list'; draw(); return; }

    if (str === '/') { state.mode = 'search'; draw(); return; }
    if (str === 'x' || key.name === 'delete') {
      if (state.rows[state.selected]?.pid != null) { state.mode = 'confirmKill'; draw(); }
      return;
    }
    if (key.name === 'a') { state.all = !state.all; refresh(); return; }
    if (key.name === 'n') { state.nodeOnly = !state.nodeOnly; refresh(); return; }
    if (key.name === 'r') { refresh(); return; }
  }

  function move(delta) {
    state.selected += delta;
    clampSelection();
    state.status = '';
    draw();
  }

  function quit() {
    if (timer) clearInterval(timer);
    process.stdout.write('\x1b[?25h'); // imleci geri getir
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    console.log(chalk.dim('\nÇıkıldı.'));
    process.exit(0);
  }

  await refresh();
  timer = setInterval(refresh, intervalMs);
}

function colorState(state) {
  if (state === 'Listen') return chalk.green('Listen');
  if (state === 'Established') return chalk.yellow('Established');
  return state ? chalk.dim(state) : chalk.dim('—');
}

function searchText(r) {
  return [
    r.localPort,
    r.proto,
    r.state,
    r.pid,
    r.info.label,
    r.info.project?.name,
    r.info.project?.dir,
    r.proc?.ExecutablePath,
    r.proc?.CommandLine,
  ]
    .join(' ')
    .toLowerCase();
}

function wrap(text, width) {
  if (text.length <= width) return text;
  const lines = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n  ');
}
