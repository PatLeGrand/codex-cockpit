// Opt-in integration test run as the main module of an isolated Electron fixture.
// Never load this script in the user's active Codex process.
const { app, protocol, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.COCKPIT_SMOKE_ROOT;
if (!base) throw new Error('COCKPIT_SMOKE_ROOT is required');
app.setPath('userData', path.join(base, 'profile'));
process.env.CODEX_HOME = path.join(base, 'codex-fixture');
const sessions = path.join(process.env.CODEX_HOME, 'sessions', '2026', '01', '01');
mkdirSync(sessions, { recursive: true });
const event = (type, payload) => JSON.stringify({ type, timestamp: new Date().toISOString(), payload }) + '\n';
writeFileSync(path.join(sessions, 'root.jsonl'), event('session_meta', { id: 'smoke-root', cwd: '/synthetic' }) + event('event_msg', { type: 'task_started' }) + event('event_msg', { type: 'token_count', info: { last_token_usage: { total_tokens: 43000 }, model_context_window: 100000 } }));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);
require(path.join(base, 'native', 'host.cjs')).attach();
const timeout = setTimeout(() => { console.error('SMOKE FAIL: native adapter timeout'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  protocol.handle('app', () => new Response('<!doctype html><html><meta charset="utf-8"><body style="background:#171a17;color:white;font:14px system-ui;padding:30px"><h1>Fixture native Electron</h1><p>Données synthétiques — ce n’est pas un chat réel</p><div style="margin-top:200px" data-codex-composer-root data-composer-placement="thread" data-cockpit-thread-id="smoke-root"><textarea aria-label="draft">Brouillon conservé</textarea></div></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL('app://-/index.html');
    const evaluate = code => window.webContents.executeJavaScript(code);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.querySelector('codex-cockpit')?.shadowRoot?.textContent.includes('43 %')`)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'Native host must render actual normalized fixture metrics');
    assert.equal(await evaluate(`typeof globalThis.__codexCockpitNative`), 'undefined', 'Adapter global must be isolated from app world');
    assert.equal(await evaluate(`document.querySelector('codex-cockpit').nextElementSibling.hasAttribute('data-codex-composer-root')`), true);
    await evaluate(`document.querySelector('codex-cockpit').shadowRoot.querySelector('.bar').click()`);
    assert.equal(await evaluate(`document.querySelector('codex-cockpit-panel').shadowRoot.querySelector('.panel').hidden`), false);
    assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Brouillon conservé');
    // A route change with no local journal must clear the old metrics.
    await evaluate(`document.querySelector('[data-codex-composer-root]').setAttribute('data-cockpit-thread-id','missing')`);
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(await evaluate(`document.querySelector('codex-cockpit').shadowRoot.querySelector('.bar').textContent.includes('43 %')`), false);
    const image = await window.webContents.capturePage();
    writeFileSync(path.join(base, 'native-smoke.png'), image.toPNG());
    console.log('SMOKE PASS: isolated world, local metrics, above-composer placement, arrow, draft preservation, conversation change');
    clearTimeout(timeout); window.destroy(); app.quit();
  } catch (error) { console.error('SMOKE FAIL:', error); clearTimeout(timeout); app.exit(1); }
});
