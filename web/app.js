const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('cockpit-token') || '';
if (token) sessionStorage.setItem('cockpit-token', token);
history.replaceState(null, '', location.pathname + location.search);
const selected = new URLSearchParams(location.search).get('session') || '';
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
  $('connection').textContent = data.source === 'demo' ? 'DÉMONSTRATION · données fictives' : 'Connecté · local';
  const notes = [];
  if (!s) notes.push(selected ? 'Cette session ne figure pas parmi les journaux locaux récents.' : 'Ouvre le Cockpit depuis la conversation à observer : aucune session n’est sélectionnée.');
  if (data.source === 'demo') notes.push('Démonstration : ces données sont fictives. Lance sans --demo pour lire Codex.');
  if (s?.stale) notes.push('Aucun événement récent : l’agent peut être inactif. État issu du journal.');
  if (s?.partial || s?.catchingUp) notes.push('Lecture du journal en cours ou incomplète ; certaines données peuvent manquer.');
  if (data.nay?.available === false) notes.push('Détection des processus Nay indisponible.');
  if (data.unreadable) notes.push(`${data.unreadable} journal(aux) inaccessible(s).`);
  $('notice').hidden = !notes.length; $('notice').textContent = notes.join(' ');
  const percent = s?.context?.percent;
  const pct = percent == null ? '—' : `≈ ${percent} %`;
  meter('bar-meter', percent); meter('detail-meter', percent);
  $('bar-percent').textContent = pct; $('detail-percent').textContent = pct;
  $('bar-tokens').textContent = compact(s?.context?.used);
  const agents = data.agents.filter(a => a.status === 'running' && !a.stale);
  const active = agents.length;
  $('bar-agents').textContent = !s ? '— agent actif' : `${active} agent${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}`;
  $('context-numbers').textContent = s?.context?.used != null ? `${compact(s.context.used)} / ${compact(s.context.window)} tokens · dernier appel observé` : 'Mesure de contexte indisponible';
  $('agents-total').textContent = active;
  list('agents', agents, agent => {
    const el = text('li', '');
    el.append(activityRow(agent, agent.name, elapsed(agent.startedAt, agent.status === 'running' ? Date.now() : agent.updatedAt), 'div'));
    el.append(text('div', [agent.role, agent.stale ? 'sans événement récent' : stateLabels[agent.status]].filter(Boolean).join(' · '), 'agent-role'));
    return el;
  }, 'Aucun agent actif pour cette session.');
  $('updated').textContent = `Actualisé à ${new Date(data.generatedAt).toLocaleTimeString('fr')} · lecture locale`;
}
function setOpen(open) { $('cockpit').hidden = !open; $('toggle').setAttribute('aria-expanded', String(open)); $('arrow').textContent = open ? '▾' : '◂'; localStorage.setItem('cockpit-open', String(open)); }
$('toggle').addEventListener('click', () => setOpen($('cockpit').hidden));
$('close').addEventListener('click', () => { setOpen(false); $('toggle').focus(); });
$('expand').addEventListener('click', () => { const wide = $('cockpit').classList.toggle('wide'); $('expand').setAttribute('aria-label', wide ? 'Réduire le panneau' : 'Agrandir le panneau'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); $('toggle').focus(); } });
setOpen(localStorage.getItem('cockpit-open') === 'true');
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const response = await fetch(`/api/snapshot${selected ? `?session=${encodeURIComponent(selected)}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 401 ? 'Accès expiré : rouvre l’URL fournie par Cockpit.' : 'Lecture locale indisponible.');
    render(await response.json());
  } catch (error) { $('connection').textContent = 'Déconnecté'; $('notice').hidden = false; $('notice').textContent = error instanceof TypeError ? 'Le service local du Cockpit est arrêté. Rouvre le Cockpit depuis cette conversation pour rétablir la connexion.' : error.message; }
  finally { busy = false; }
}
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
