import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { isNativeUrl } from '../native/host.cjs';

test('native adapter accepts only application-owned main windows', () => {
  for (const url of ['app://-/index.html', 'app://-/detached-window.html?initialRoute=/threads/test']) assert.equal(isNativeUrl(url), true);
  for (const url of ['https://chatgpt.com', 'app://evil/index.html', 'app://-/sandbox.html', 'file:///index.html', 'not-url']) assert.equal(isNativeUrl(url), false);
});

test('host uses isolated-world calls, exact conversation and unregisters destroyed windows', { skip: !vm.SyntheticModule }, async () => {
  const source = await readFile(new URL('../native/host.cjs', import.meta.url), 'utf8');
  const app = new EventEmitter(); app.whenReady = () => Promise.resolve();
  const wc = new EventEmitter(); wc.id = 3; wc.getType = () => 'window'; wc.getURL = () => 'app://-/index.html'; wc.isDestroyed = () => false; wc.isLoadingMainFrame = () => false;
  const evaluated = []; let interval, cleared = false;
  wc.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
    evaluated.push({ world, code: scripts[0].code });
    if (scripts[0].code.includes('?.mount(')) return { mounted: true, session: 'current-conversation' };
  };
  const queried = [];
  const context = {
    exports: {}, __dirname: '/fixture', URL, console, process: { env: {} },
    setInterval: fn => { interval = fn; return { unref() {} }; }, clearInterval: () => { cleared = true; },
    require: name => name === 'electron' ? { app, webContents: { getAllWebContents: () => [] } }
      : name === 'node:fs' ? { readFileSync: file => file.endsWith('renderer.js') ? '/* renderer bootstrap */' : '/* css */' }
        : name === 'node:path' ? path : name === 'node:os' ? os : name === 'node:url' ? { pathToFileURL: file => ({ href: 'file://' + file }) } : null,
  };
  const module = new vm.Script(source, { importModuleDynamically: async () => {
    const namespace = new vm.SyntheticModule(['SessionStore'], function () {
      this.setExport('SessionStore', class { async snapshot(id) { queried.push(id); return { selected: { id } }; } });
    });
    await namespace.link(() => {}); await namespace.evaluate(); return namespace;
  } });
  // Dynamic import in a vm requires Node's experimental VM modules flag; the
  // runtime itself uses ordinary import, which does not require this flag.
  module.runInNewContext(context);
  context.exports.attach(); context.exports.attach();
  app.emit('web-contents-created', {}, wc);
  for (let i = 0; i < 50 && !queried.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(queried, ['current-conversation']);
  assert.ok(evaluated.every(item => item.world === 742103));
  assert.ok(evaluated.some(item => item.code.includes('?.update(')));
  wc.emit('destroyed'); assert.ok(cleared);
  await interval(); assert.equal(queried.length, 1);
});
