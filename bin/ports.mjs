#!/usr/bin/env node
// Port Inspector — bilgisayardaki açık/dinlenen portları, arkalarındaki süreçleri
// ve Node projelerini tespit eden çapraz platform CLI.
// Varsayılan: interaktif canlı TUI. TTY yoksa veya --once/--json ile tek seferlik.

import { parseArgs } from 'node:util';
import chalk from 'chalk';

import { collectRaw } from '../src/collect.mjs';
import { buildPortList } from '../src/identify.mjs';
import { filterRows, renderTable, summary } from '../src/render.mjs';
import { runInteractive } from '../src/interactive.mjs';

const { values } = parseArgs({
  options: {
    once: { type: 'boolean', short: 'o', default: false },
    interval: { type: 'string', short: 'i', default: '3' },
    all: { type: 'boolean', short: 'a', default: false },
    node: { type: 'boolean', short: 'n', default: false },
    port: { type: 'string', short: 'p' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const opts = {
  all: values.all,
  nodeOnly: values.node,
  port: values.port != null ? Number(values.port) : null,
};

async function once() {
  const rows = buildPortList(await collectRaw());
  const filtered = filterRows(rows, opts);
  if (values.json) {
    process.stdout.write(JSON.stringify(filtered.map(toPlain), null, 2) + '\n');
    return;
  }
  console.log(renderTable(filtered));
  console.log(summary(filtered));
}

function toPlain(r) {
  return {
    port: r.localPort,
    proto: r.proto,
    state: r.state,
    address: r.localAddress,
    remote: r.remote,
    pid: r.pid,
    type: r.info.type,
    label: r.info.label,
    project: r.info.project,
    executable: r.proc?.ExecutablePath ?? null,
    commandLine: r.proc?.CommandLine ?? null,
  };
}

function printHelp() {
  console.log(`
${chalk.bold('Port Inspector')} — açık portları ve arkalarındaki süreçleri/Node projelerini tespit eder.

${chalk.bold('Kullanım:')}
  ports [seçenekler]

${chalk.bold('Mod:')}
  (argümansız)         İnteraktif canlı TUI (ok tuşlarıyla gezin, kill, ara)
  -o, --once           Tek seferlik tablo bas ve çık
      --json           Tek seferlik JSON çıktı (script entegrasyonu)

${chalk.bold('Filtreler:')}
  -a, --all            Established dahil tüm bağlantıları göster (yalnızca dinlenen değil)
  -n, --node           Sadece Node/Bun/Deno süreçlerini göster
  -p, --port <no>      Belirli bir portu filtrele
  -i, --interval <sn>  İnteraktif modda yenileme aralığı (varsayılan: 3)
  -h, --help           Bu yardım

${chalk.bold('İnteraktif kısayollar:')}
  ↑/↓ veya j/k  satır seç      Enter/d  detay        x veya Del  süreci sonlandır
  /             ara            a        tümü aç/kapat  n           sadece Node
  r             yenile         q        çık

${chalk.bold('Örnekler:')}
  ports                 İnteraktif panel
  ports -n              Sadece Node projeleri (interaktif)
  ports --once -p 3000  3000 portunu kim tutuyor?
  ports --json > ports.json
`);
}

try {
  // İnteraktif mod yalnızca gerçek bir terminalde (TTY) anlamlı.
  const interactive = !values.once && !values.json && process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) await runInteractive(opts, values.interval);
  else await once();
} catch (err) {
  console.error(chalk.red('Hata: ' + err.message));
  process.exit(1);
}
