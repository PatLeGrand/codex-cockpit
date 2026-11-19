import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';

async function bounded(file, limit = 65536) {
  const info = await stat(file);
  if (info.size > limit) throw new Error('Oversized metadata');
  const data = await readFile(file);
  if (data.length > limit) throw new Error('Oversized metadata');
  return data.toString('utf8');
}

// Keep only process identity and flags needed for attribution. Prompts, cwd and
// the rest of the environment are never returned or retained in snapshots.
export async function readProcesses(root = '/proc') {
  const processes = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    try {
      if (process.getuid && (await stat(dir)).uid !== process.getuid()) continue;
      const [rawArgs, rawStat] = await Promise.all([bounded(path.join(dir, 'cmdline')), bounded(path.join(dir, 'stat'))]);
      const args = rawArgs.split('\0').filter(Boolean);
      const fields = rawStat.slice(rawStat.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (fields[0] === 'Z' || fields[0] === 'X') continue;
      let callerSessionId = null;
      const nayIndex = args.findIndex(arg => ['nay', 'nay.js'].includes(path.basename(arg)));
      if (nayIndex >= 0 && ['run', 'story', 'resume'].includes(args[nayIndex + 1])) {
        const env = (await bounded(path.join(dir, 'environ'), 262144)).split('\0');
        const value = key => env.find(item => item.startsWith(key + '='))?.slice(key.length + 1);
        callerSessionId = value('CODEX_THREAD_ID') || value('CODEX_SESSION_ID') || null;
      }
      const modelIndex = args.findIndex(arg => arg === '-m' || arg === '--model');
      const model = modelIndex >= 0 ? args[modelIndex + 1] : args.find(arg => arg.startsWith('--model='))?.slice(8);
      const provider = args.slice(0, 3).map(arg => path.basename(arg)).find(name => /^(codex|codex\.js|claude|claude\.js|agy|agy\.js)$/.test(name))?.replace(/\.js$/, '');
      processes.push({ pid: Number(entry.name), parentPid: Number(fields[1]), startKey: fields[19],
        callerSessionId, nayScript: nayIndex >= 0 ? args[nayIndex] : null,
        action: nayIndex >= 0 ? args[nayIndex + 1] : null,
        agent: nayIndex >= 0 && args[nayIndex + 1] === 'run' ? args[nayIndex + 2] : null,
        provider, model });
    } catch { /* Process exited or OS denied metadata access. */ }
  }
  return processes;
}

export function activeNayAgents(processes, sessionIds, models = {}) {
  const byPid = new Map(processes.map(item => [item.pid, item]));
  const nayRoots = new Map(processes.filter(item => sessionIds.has(item.callerSessionId) && ['run', 'story', 'resume'].includes(item.action)).map(item => [item.pid, item]));
  const result = [];
  const emit = (process, root, name) => result.push({
    id: `nay:${process.pid}:${process.startKey}`, parentId: root.callerSessionId,
    name, role: 'Nay', source: 'nay', status: 'running', stale: false,
    startedAt: null, updatedAt: Date.now(),
  });
  for (const root of nayRoots.values()) {
    if (root.action === 'run' && root.agent && !root.agent.startsWith('-')) { emit(root, root, root.agent); continue; }
    for (const candidate of processes) {
      if (!candidate.provider || !candidate.model) continue;
      let ancestor = byPid.get(candidate.parentPid);
      const seen = new Set([candidate.pid]); let linked = false, wrapped = false;
      while (ancestor && !seen.has(ancestor.pid)) {
        seen.add(ancestor.pid);
        if (ancestor.pid === root.pid) { linked = true; break; }
        if (nayRoots.has(ancestor.pid)) break;
        if (ancestor.provider && ancestor.model) wrapped = true;
        ancestor = byPid.get(ancestor.parentPid);
      }
      if (!linked || wrapped) continue;
      const names = Object.entries(models).filter(([, value]) => value && typeof value.model === 'string' && value.cli === candidate.provider && (
        value.model === candidate.model || value.model?.replaceAll('{effort}', value.effort ?? 'medium') === candidate.model ||
        (value.model?.includes('{effort}') && candidate.model.startsWith(value.model.split('{effort}')[0]) && ['low', 'medium', 'high', 'xhigh'].includes(candidate.model.slice(value.model.indexOf('{effort}'))))
      )).map(([name]) => name);
      emit(candidate, root, names.length === 1 ? names[0] : candidate.model);
    }
  }
  return result;
}

export class NayMonitor {
  constructor({ procRoot = '/proc', processes = () => readProcesses(procRoot) } = {}) { this.processes = processes; this.models = new Map(); }
  async active(sessionIds) {
    if (!sessionIds.size) return { agents: [], available: true };
    try {
      const processes = await this.processes();
      const models = {};
      for (const item of processes) {
        if (!sessionIds.has(item.callerSessionId) || !item.nayScript) continue;
        try {
          const script = await realpath(item.nayScript);
          const file = path.resolve(path.dirname(script), '../config/agents.json');
          if (!this.models.has(file)) this.models.set(file, JSON.parse(await bounded(file)));
          Object.assign(models, this.models.get(file));
        } catch { /* Explicit `nay run <name>` still works without its config. */ }
      }
      return { agents: activeNayAgents(processes, sessionIds, models), available: true };
    } catch { return { agents: [], available: false }; }
  }
}
