/* Executed only in an isolated world of Codex's app://- main renderer. */
(() => {
  if (globalThis.__codexCockpitNative) return;
  let root, host, portal, shadow, snapshot, currentId, opened = false;
  const el = (tag, content = '', className = '') => {
    const node = document.createElement(tag);
    node.textContent = content; node.className = className; return node;
  };
  const short = n => n == null ? '—' : new Intl.NumberFormat('fr', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const age = s => {
    if (!s?.startedAt) return '—';
    const end = s.status === 'running' ? Date.now() : s.updatedAt;
    const seconds = Math.max(0, Math.floor((end - s.startedAt) / 1000));
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  };
  const labels = { running: 'en cours', completed: 'terminé', interrupted: 'interrompu', unknown: 'inconnu', failed: 'échec' };
  const nodes = {};
  function meter(percent) {
    const node = el('span', '', 'meter'); node.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 16; i++) node.append(el('i', '', percent != null && i < Math.round(Math.min(100, percent) / 100 * 16) ? 'filled' : ''));
    return node;
  }
  function toggle(value) {
    opened = value; nodes.panel.hidden = !opened;
    nodes.bar.setAttribute('aria-expanded', String(opened)); nodes.arrow.textContent = opened ? '▾' : '◂';
  }
  function section(title) {
    const box = el('section'); box.append(el('h2', title)); const list = el('ul'); box.append(list); nodes.body.append(box); return list;
  }
  function row(item, title, duration) {
    const li = el('li', '', 'row');
    const status = Object.hasOwn(labels, item.status) ? item.status : 'unknown';
    li.append(el('span', status === 'running' ? '•' : status === 'completed' ? '✓' : status === 'unknown' ? '?' : '×', `status ${status}`), el('span', title));
    li.title = labels[status]; if (duration) li.append(el('span', duration, 'duration')); return li;
  }
  function make(css) {
    host = document.createElement('codex-cockpit');
    host.setAttribute('data-codex-cockpit-native', '');
    host.style.cssText = 'display:block;width:100%;min-width:0;flex-shrink:0;margin-bottom:8px;position:relative;z-index:20;pointer-events:auto';
    shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css); shadow.adoptedStyleSheets = [sheet];
    nodes.bar = el('button', '', 'bar'); nodes.bar.type = 'button';
    nodes.bar.setAttribute('aria-label', 'Ouvrir le Cockpit'); nodes.bar.setAttribute('aria-expanded', String(opened));
    nodes.barMeter = meter(null); nodes.percent = el('strong', '—'); nodes.tokens = el('span', 'Contexte'); nodes.active = el('span', '— sous-agent', 'agents'); nodes.arrow = el('span', '◂', 'arrow');
    nodes.bar.append(nodes.barMeter, nodes.percent, nodes.tokens, el('span', '·'), nodes.active, nodes.arrow);
    nodes.bar.addEventListener('click', () => toggle(!opened));
    nodes.panel = el('aside', '', 'panel'); nodes.panel.id = 'native-cockpit-panel'; nodes.panel.setAttribute('aria-label', 'Cockpit');
    const header = el('header'); const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Fermer le Cockpit');
    close.addEventListener('click', () => { toggle(false); nodes.bar.focus(); }); header.append(el('h1', 'Cockpit'), close);
    nodes.body = el('div', '', 'body'); nodes.panel.append(header, nodes.body);
    nodes.context = el('p'); nodes.notice = el('p', '', 'notice'); nodes.body.append(nodes.context, nodes.notice);
    nodes.agents = section('Sous-agents de cette session');
    nodes.footer = el('footer', 'Lecture locale · contexte estimé'); nodes.panel.append(nodes.footer);
    // A portal avoids clipping by transformed or overflow-hidden composer parents.
    portal = document.createElement('codex-cockpit-panel');
    portal.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    const panelShadow = portal.attachShadow({ mode: 'open' }); panelShadow.adoptedStyleSheets = [sheet];
    panelShadow.append(nodes.panel); shadow.append(nodes.bar); document.body.append(portal);
    const escape = event => { if (event.key === 'Escape' && opened) { event.stopPropagation(); toggle(false); nodes.bar.focus(); } };
    shadow.addEventListener('keydown', escape); panelShadow.addEventListener('keydown', escape);
    toggle(opened);
  }
  function render() {
    if (!host) return;
    const data = snapshot?.selected?.id === currentId ? snapshot : null;
    const s = data?.selected; const percent = s?.context?.percent;
    const pct = percent == null ? '—' : `≈ ${percent} %`;
    const barMeter = meter(percent); nodes.barMeter.replaceWith(barMeter); nodes.barMeter = barMeter;
    nodes.percent.textContent = pct; nodes.tokens.textContent = short(s?.context?.used);
    const active = data?.agents?.filter(a => a.status === 'running' && !a.stale).length ?? 0;
    const total = data?.agents?.length ?? 0;
    nodes.active.textContent = !s ? '— sous-agent' : `${total} sous-agent${total > 1 ? 's' : ''}${total ? ` · ${active} actif${active > 1 ? 's' : ''}` : ''}`;
    nodes.bar.setAttribute('aria-label', `Cockpit : ${pct} de contexte, ${total} sous-agent${total > 1 ? 's' : ''}`);
    nodes.context.textContent = s ? `${pct} · ${short(s.context?.used)} / ${short(s.context?.window)} tokens` : 'Mesure de contexte indisponible';
    nodes.notice.textContent = !currentId ? 'Ouvre une conversation Codex pour afficher ses métriques.' : !s ? 'Cette conversation ne figure pas dans les journaux locaux récents.' : s.stale ? 'Sans événement récent : état en cours non confirmé.' : s.catchingUp || s.partial ? 'Lecture du journal en cours ou incomplète.' : '';
    nodes.notice.hidden = !nodes.notice.textContent;
    nodes.agents.replaceChildren(...(data?.agents ?? []).map(a => {
      const li = row(a, a.name, age(a)); if (a.role || a.stale) li.append(el('small', [a.role, a.stale ? 'sans événement récent' : labels[a.status]].filter(Boolean).join(' · '))); return li;
    }));
    if (!nodes.agents.children.length) nodes.agents.append(el('li', 'Aucun sous-agent observé.', 'empty'));
    nodes.footer.textContent = `Lecture locale · estimation · ${data ? new Date(data.generatedAt).toLocaleTimeString('fr') : 'en attente'}`;
  }
  globalThis.__codexCockpitNative = {
    mount(css) {
      // Versioned adapter deliberately requires an explicit native composer marker.
      const candidates = [...document.querySelectorAll('[data-codex-composer-root][data-cockpit-thread-id]')];
      const next = candidates.find(n => n.getAttribute('data-composer-placement') === 'thread' && n.getBoundingClientRect().width > 0)
        ?? candidates.find(n => n.getBoundingClientRect().width > 0);
      if (!next) { host?.remove(); portal?.remove(); root = null; currentId = null; return { mounted: false, session: null, composers: document.querySelectorAll('[data-codex-composer-root]').length }; }
      if (!host) make(css);
      if (!portal.isConnected) document.body.append(portal);
      if (next !== root || host.nextSibling !== next) { next.before(host); root = next; }
      const id = next.getAttribute('data-cockpit-thread-id') || null;
      if (id !== currentId) { currentId = id; snapshot = null; render(); }
      return { mounted: true, session: currentId };
    },
    update(data) { snapshot = data; render(); },
    destroy() { host?.remove(); portal?.remove(); delete globalThis.__codexCockpitNative; },
  };
})();
