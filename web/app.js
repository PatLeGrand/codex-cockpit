const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('cockpit-token') || '';
if (token) sessionStorage.setItem('cockpit-token', token);
history.replaceState(null, '', location.pathname + location.search);
let selected = new URLSearchParams(location.search).get('session') || '';
const compact = n => n == null ? '—' : new Intl.NumberFormat('fr', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const elapsed = (start, end = Date.now()) => {
  if (!start) return '—';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};
const stateLabels = { running: 'en cours', completed: 'terminé', interrupted: 'interrompu', failed: 'échec', unknown: 'état inconnu' };
function meter(id, percent) {
  const el = $(id); el.replaceChildren();
  el.className = `meter ${percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : ''}`;
  for (let i = 0; i < 16; i++) { const segment = document.createElement('i'); if (percent != null && i < Math.round(Math.min(100, percent) / 100 * 16)) segment.className = 'filled'; el.append(segment); }
}
function text(tag, value, className) { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
function list(id, items, create, empty) { const el = $(id); el.replaceChildren(...items.map(create)); if (!items.length) el.append(text('li', empty, 'empty')); }
function activityRow(item, name, duration, tag = 'li') {
  const row = text(tag, '', 'row');
  const status = Object.hasOwn(stateLabels, item.status) ? item.status : 'unknown';
  row.append(text('span', status === 'running' ? '•' : status === 'completed' ? '✓' : status === 'unknown' ? '?' : '×', `status ${status}`));
  row.append(text('span', name, 'name'));
  row.title = stateLabels[status];
  if (duration) row.append(text('span', duration, 'elapsed'));
  return row;
}
function render(data) {
  const s = data.selected;
  const options = data.sessions.map(item => {
    const label = `${item.cwd?.split('/').filter(Boolean).pop() || 'Session'} · ${item.id.slice(0, 8)}`;
    const option = text('option', label); option.value = item.id; return option;
  });
  const placeholder = text('option', 'Suivre la conversation la plus récente'); placeholder.value = '';
  $('session').replaceChildren(placeholder, ...options); $('session').value = selected;
  $('connection').textContent = data.source === 'demo' ? 'DÉMONSTRATION · données fictives' : 'Connecté · local';
  const notes = [];
  if (!s) notes.push(selected ? 'Cette session ne figure pas parmi les sessions récentes chargées.' : 'Aucune session locale trouvée. Ouvre une conversation Codex, puis patiente quelques secondes.');
  if (data.source === 'demo') notes.push('Démonstration : ces données sont fictives. Lance sans --demo pour lire Codex.');
  if (s?.stale) notes.push('Aucun événement récent : l’agent peut être inactif. État issu du journal.');
  if (s?.partial || s?.catchingUp) notes.push('Lecture du journal en cours ou incomplète ; certaines données peuvent manquer.');
  if (data.unreadable) notes.push(`${data.unreadable} journal(aux) inaccessible(s).`);
  $('notice').hidden = !notes.length; $('notice').textContent = notes.join(' ');
  const percent = s?.context?.percent;
  const pct = percent == null ? '—' : `≈ ${percent} %`;
  meter('bar-meter', percent); meter('detail-meter', percent);
  $('bar-percent').textContent = pct; $('detail-percent').textContent = pct;
  $('bar-tokens').textContent = compact(s?.context?.used);
  $('bar-time').textContent = elapsed(s?.startedAt, s?.status === 'running' ? Date.now() : s?.updatedAt);
  const active = data.agents.filter(a => a.status === 'running' && !a.stale).length;
  $('bar-agents').textContent = `${active} agent${active === 1 ? '' : 's'}`;
  $('context-numbers').textContent = s?.context?.used != null ? `${compact(s.context.used)} / ${compact(s.context.window)} tokens · dernier appel observé` : 'Mesure de contexte indisponible';
  $('model').textContent = s ? `${s.model ?? 'Modèle non renseigné'} · ${stateLabels[s.status] ?? 'état inconnu'}` : '';
  const primary = s?.limits?.primary; const secondary = s?.limits?.secondary;
  $('quotas').textContent = [primary && `${primary.window_minutes / 60} h : ${primary.used_percent} % utilisés`, secondary && `${secondary.window_minutes / 1440} j : ${secondary.used_percent} % utilisés`].filter(Boolean).join(' · ');
  $('agents-total').textContent = data.agents.length;
  list('agents', data.agents, agent => {
    const el = text('li', '');
    el.append(activityRow(agent, agent.name, elapsed(agent.startedAt, agent.status === 'running' ? Date.now() : agent.updatedAt), 'div'));
    el.append(text('div', [agent.role, agent.stale ? 'sans événement récent' : stateLabels[agent.status]].filter(Boolean).join(' · '), 'agent-role'));
    return el;
  }, 'Aucun sous-agent observé pour cette conversation.');
  const files = s?.files ?? []; $('files-total').textContent = files.length;
  list('files', files, file => text('li', file, 'file'), 'Aucun fichier identifié dans les appels structurés.');
  list('activity', [...(s?.activities ?? [])].reverse().slice(0, 30), item => activityRow(item, item.name), 'Aucune activité observée.');
  $('updated').textContent = `Actualisé à ${new Date(data.generatedAt).toLocaleTimeString('fr')} · lecture locale`;
}
function setOpen(open) { $('cockpit').hidden = !open; $('toggle').setAttribute('aria-expanded', String(open)); $('arrow').textContent = open ? '▾' : '◂'; localStorage.setItem('cockpit-open', String(open)); }
$('toggle').addEventListener('click', () => setOpen($('cockpit').hidden));
$('close').addEventListener('click', () => { setOpen(false); $('toggle').focus(); });
$('expand').addEventListener('click', () => { const wide = $('cockpit').classList.toggle('wide'); $('expand').setAttribute('aria-label', wide ? 'Réduire le panneau' : 'Agrandir le panneau'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); $('toggle').focus(); } });
$('session').addEventListener('change', () => { selected = $('session').value; refresh(); });
$('follow').addEventListener('click', () => { selected = ''; refresh(); });
setOpen(localStorage.getItem('cockpit-open') === 'true');
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const response = await fetch(`/api/snapshot${selected ? `?session=${encodeURIComponent(selected)}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 401 ? 'Accès expiré : rouvre l’URL fournie par Cockpit.' : 'Lecture locale indisponible.');
    render(await response.json());
  } catch (error) { $('connection').textContent = 'Déconnecté'; $('notice').hidden = false; $('notice').textContent = error.message; }
  finally { busy = false; }
}
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
