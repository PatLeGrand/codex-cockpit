// Synthetic browser fixture for the real native renderer. No private data.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { demoStore } from '../src/demo.mjs';
const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Cockpit — banc de test natif</title>
<style>body{background:#151715;color:#d9e0db;font:14px system-ui;margin:0}main{max-width:800px;margin:36px auto;padding:20px}h1{font-size:18px}.label{color:#dfb278}article{height:260px;padding-top:35px;color:#9da99f}[data-codex-composer-root]{border:1px solid #444d46;border-radius:14px;padding:16px;background:#222622}textarea{width:100%;min-height:75px;background:transparent;border:0;color:inherit;font:inherit;resize:vertical}button{padding:8px}#route{margin-top:16px} .footer{font-size:11px;color:#819286}</style>
<main><h1>Codex Cockpit · intégration native</h1><p class="label">Banc de test — données fictives, ceci n’est pas l’application Codex.</p><article>Le composant utilise les mêmes marqueurs que le composeur de Codex.<br>La barre doit apparaître juste au-dessus du champ de saisie.</article><div id="slot"><div data-codex-composer-root data-cockpit-thread-id="demo" data-composer-placement="thread"><textarea aria-label="Brouillon de test" placeholder="Écris un brouillon pour vérifier qu’il est conservé"></textarea><button type="button">Envoyer (inactif)</button></div></div><button id="route">Changer de conversation</button><button id="remount">Recréer le composeur</button><p class="footer">Vérifier : flèche, fermeture, changement de conversation, une seule barre après remontage.</p></main><script src="/native.js"></script><script src="/fixture.js"></script></html>`;
const fixture = `let data,css;async function tick(){const state=globalThis.__codexCockpitNative.mount(css);if(state.session){data.selected.id=state.session;data.selected.context.percent=state.session==='demo'?43:11;data.selected.context.used=state.session==='demo'?429000:110000;globalThis.__codexCockpitNative.update(data)}}
Promise.all([fetch('/data').then(r=>r.json()),fetch('/native.css').then(r=>r.text())]).then(v=>{[data,css]=v;tick();setInterval(tick,250)});
document.querySelector('#route').onclick=()=>{const root=document.querySelector('[data-codex-composer-root]');root.setAttribute('data-cockpit-thread-id',root.getAttribute('data-cockpit-thread-id')==='demo'?'other':'demo');tick()};
document.querySelector('#remount').onclick=()=>{const root=document.querySelector('[data-codex-composer-root]');root.replaceWith(root.cloneNode(true));tick()};`;
const server = http.createServer(async (req, res) => {
  const routes = { '/native.js': ['../native/renderer.js', 'text/javascript'], '/native.css': ['../native/style.css', 'text/css'] };
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fixture); }
  if (req.url === '/data') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(await demoStore.snapshot())); }
  const route = routes[req.url]; if (!route) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', route[1]); res.end(await readFile(new URL(route[0], import.meta.url)));
});
server.listen(0, '127.0.0.1', () => console.log('Native fixture: http://127.0.0.1:' + server.address().port));
