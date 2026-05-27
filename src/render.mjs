// Port listesini renkli tablo olarak çizer (chalk + cli-table3).

import chalk from 'chalk';
import Table from 'cli-table3';

const TYPE_COLOR = {
  node: chalk.green,
  system: chalk.gray,
  browser: chalk.blue,
  other: chalk.white,
  unknown: chalk.red,
};

/**
 * Satırları filtreler.
 * @param {Array} rows
 * @param {{all:boolean, nodeOnly:boolean, port:number|null}} opts
 */
export function filterRows(rows, opts) {
  let out = rows;

  // Varsayılan: yalnızca dinlenen (LISTEN) TCP + tüm UDP. --all hepsini gösterir.
  if (!opts.all) {
    out = out.filter((r) => r.proto === 'UDP' || r.state === 'Listen');
  }
  if (opts.nodeOnly) out = out.filter((r) => r.info.type === 'node');
  if (opts.port != null) out = out.filter((r) => r.localPort === opts.port);

  // Aynı port+pid+proto'nun 0.0.0.0/:: gibi tekrarlarını sadeleştir.
  const seen = new Map();
  for (const r of out) {
    const key = `${r.proto}|${r.localPort}|${r.pid}|${r.state}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  out = [...seen.values()];

  out.sort((a, b) => a.localPort - b.localPort || a.proto.localeCompare(b.proto));
  return out;
}

export function renderTable(rows) {
  const table = new Table({
    head: ['PORT', 'PROTO', 'DURUM', 'PID', 'SÜREÇ / ARAÇ', 'PROJE (package.json)', 'YOL'].map((h) =>
      chalk.bold.cyan(h)
    ),
    style: { head: [], border: [] },
    colWidths: [7, 7, 12, 8, 26, 26, 40],
    wordWrap: true,
  });

  for (const r of rows) {
    const color = TYPE_COLOR[r.info.type] || chalk.white;
    const project = r.info.project ? r.info.project.name : r.info.type === 'node' ? chalk.dim('?') : '';
    const path = r.info.project?.dir || (r.proc?.ExecutablePath ?? '');
    table.push([
      chalk.bold(String(r.localPort)),
      r.proto,
      r.state ? colorState(r.state) : chalk.dim('—'),
      r.pid ?? chalk.dim('—'),
      color(r.info.label),
      project,
      chalk.dim(path),
    ]);
  }
  return table.toString();
}

function colorState(state) {
  if (state === 'Listen') return chalk.green('Listen');
  if (state === 'Established') return chalk.yellow('Established');
  return chalk.dim(state);
}

export function summary(rows) {
  const nodeCount = rows.filter((r) => r.info.type === 'node').length;
  const ports = new Set(rows.map((r) => r.localPort)).size;
  return chalk.dim(
    `${rows.length} kayıt · ${ports} farklı port · ${chalk.green(nodeCount + ' Node')} süreci`
  );
}
