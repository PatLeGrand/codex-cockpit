'use strict';
// Main-process adapter. No renderer IPC, filesystem bridge, network or debug port.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const WORLD = 742103;
let attached = false;

function isNativeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'app:' && url.hostname === '-' && ['/index.html', '/detached-window.html'].includes(url.pathname); }
  catch { return false; }
}

exports.isNativeUrl = isNativeUrl;
exports.attach = function attach() {
  if (attached) return; attached = true;
  const { app, webContents } = require('electron');
  const renderer = readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const css = readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const storeReady = import(pathToFileURL(path.join(__dirname, 'sessions.mjs')).href).then(({ SessionStore }) => new SessionStore(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')));
  const watched = new Set();
  // Serialize disk scans across native windows.
  let scan = Promise.resolve();
  function observe(contents) {
    if (contents.getType() !== 'window' || watched.has(contents.id)) return;
    watched.add(contents.id);
    let busy = false, mounted = false, disposed = false;
    const evaluate = code => contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
    async function tick() {
      if (busy || disposed || contents.isDestroyed() || contents.isLoadingMainFrame() || !isNativeUrl(contents.getURL())) return;
      busy = true;
      try {
        if (!mounted) { await evaluate(renderer); mounted = true; }
        const state = await evaluate(`globalThis.__codexCockpitNative?.mount(${JSON.stringify(css)})`);
        if (!state?.mounted || !state.session) return;
        const store = await storeReady;
        const result = scan.then(() => store.snapshot(state.session));
        scan = result.catch(() => {});
        const data = await result;
        // Navigation may have changed during disk I/O; renderer checks session ID.
        if (!disposed && isNativeUrl(contents.getURL())) await evaluate(`globalThis.__codexCockpitNative?.update(${JSON.stringify(data)})`);
      } catch (error) { mounted = false; console.error('[codex-cockpit]', error.message); }
      finally { busy = false; }
    }
    const timer = setInterval(tick, 2000); timer.unref();
    contents.on('did-finish-load', () => { mounted = false; tick(); });
    contents.once('destroyed', () => { disposed = true; clearInterval(timer); watched.delete(contents.id); });
    tick();
  }
  app.on('web-contents-created', (_event, contents) => observe(contents));
  app.whenReady().then(() => webContents.getAllWebContents().forEach(observe));
};
