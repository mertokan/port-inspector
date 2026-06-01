// identify.mjs saf mantığının birim testleri (node:test — ek bağımlılık yok).
//   çalıştır: npm test   ya da   node --test

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPortList,
  classify,
  findProject,
  _clearProjectCache,
} from '../src/identify.mjs';

// Tek seferlik geçici proje düzeni oluşturur:
//   <root>/my-app/package.json            (name: "my-app")
//   <root>/my-app/src                     (proje içi kaynak dizini)
//   <root>/my-app/node_modules/dep/...    (node_modules — atlanmalı)
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'port-inspector-test-'));
  const app = join(root, 'my-app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'my-app' }));
  const dep = join(app, 'node_modules', 'some-dep');
  mkdirSync(join(dep, 'lib'), { recursive: true });
  writeFileSync(join(dep, 'package.json'), JSON.stringify({ name: 'some-dep' }));
  return { root, app, depLib: join(dep, 'lib') };
}

test('findProject: en yakın gerçek proje kökünü bulur', () => {
  _clearProjectCache();
  const { app } = makeFixture();
  const found = findProject(join(app, 'src'));
  assert.equal(found.name, 'my-app');
  assert.equal(found.dir, app);
});

test('findProject: node_modules içindeki yolu atlar, üstteki projeye çıkar', () => {
  _clearProjectCache();
  const { app, depLib } = makeFixture();
  const found = findProject(depLib);
  assert.equal(found.name, 'my-app', 'node_modules içindeki package.json yok sayılmalı');
  assert.equal(found.dir, app);
});

test('findProject: package.json yoksa null döner', () => {
  _clearProjectCache();
  const root = mkdtempSync(join(tmpdir(), 'port-inspector-empty-'));
  assert.equal(findProject(root), null);
});

test('findProject: package.json adı yoksa dizin adına döner', () => {
  _clearProjectCache();
  const root = mkdtempSync(join(tmpdir(), 'port-inspector-noname-'));
  const app = join(root, 'unnamed-app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  assert.equal(findProject(app).name, 'unnamed-app');
});

test('classify: Node + Vite -> type node, etiket Vite, proje çözülür', () => {
  _clearProjectCache();
  const { app } = makeFixture();
  const info = classify({
    Name: 'node.exe',
    ExecutablePath: 'C:/Program Files/nodejs/node.exe',
    CommandLine: 'node ./node_modules/vite/bin/vite.js',
    Cwd: app,
  });
  assert.equal(info.type, 'node');
  assert.match(info.label, /Vite/);
  assert.equal(info.project.name, 'my-app');
});

test('classify: yeni eklenen araçları tanır (Hardhat, Prisma, Fastify)', () => {
  const tool = (cmd) => classify({ Name: 'node', CommandLine: cmd }).label;
  assert.match(tool('node ./node_modules/.bin/hardhat node'), /Hardhat/);
  assert.match(tool('node ./node_modules/.bin/prisma studio'), /Prisma/);
  assert.match(tool('node server.js fastify'), /Fastify/);
});

test('classify: runtime\'ı çalıştırılabilir yolundan da tanır', () => {
  const info = classify({ Name: 'mystart', ExecutablePath: '/usr/local/bin/bun', CommandLine: 'bun run dev' });
  assert.equal(info.type, 'node');
  assert.match(info.label, /^bun/);
});

test('classify: sistem ve tarayıcı süreçlerini ayırır', () => {
  assert.equal(classify({ Name: 'svchost.exe', CommandLine: '' }).type, 'system');
  assert.equal(classify({ Name: 'chrome.exe', CommandLine: '' }).type, 'browser');
  assert.equal(classify({ Name: 'someapp', CommandLine: '' }).type, 'other');
  assert.equal(classify(null).type, 'unknown');
});

test('buildPortList: TCP/UDP ham veriyi zenginleştirilmiş satırlara çevirir', () => {
  _clearProjectCache();
  const raw = {
    tcp: [
      { LocalAddress: '0.0.0.0', LocalPort: '3000', RemoteAddress: '', RemotePort: 0, OwningProcess: 10, State: 'Listen' },
    ],
    udp: [{ LocalAddress: '0.0.0.0', LocalPort: '5353', OwningProcess: 20 }],
    procs: [
      { ProcessId: 10, Name: 'node', CommandLine: 'node vite' },
      { ProcessId: 20, Name: 'svchost.exe', CommandLine: '' },
    ],
  };
  const rows = buildPortList(raw);
  assert.equal(rows.length, 2);

  const tcp = rows.find((r) => r.proto === 'TCP');
  assert.equal(tcp.localPort, 3000);
  assert.equal(tcp.state, 'Listen');
  assert.equal(tcp.info.type, 'node');

  const udp = rows.find((r) => r.proto === 'UDP');
  assert.equal(udp.localPort, 5353);
  assert.equal(udp.state, '');
  assert.equal(udp.info.type, 'system');
});

test('buildPortList: süreci bilinmeyen port unknown olur', () => {
  const raw = {
    tcp: [{ LocalAddress: '0.0.0.0', LocalPort: '9999', OwningProcess: 999, State: 'Listen' }],
    udp: [],
    procs: [],
  };
  const rows = buildPortList(raw);
  assert.equal(rows[0].info.type, 'unknown');
  assert.equal(rows[0].pid, 999);
});
