import { readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const MAX_FILES = 160;
const MAX_LINE = 4 * 1024 * 1024;
const number = x => Number.isFinite(x) && x >= 0 ? x : null;
const timestamp = x => typeof x === 'number' ? (x < 1e12 ? x * 1000 : x) : Date.parse(x);

export function emptySession(file) {
  return { id: null, file, parentId: null, name: '', role: '', cwd: '', startedAt: null,
    updatedAt: null, status: 'unknown', model: null, context: null, usage: null,
    limits: null, activities: [], files: [], calls: new Map(), partial: false };
}

export function applyRecord(s, record) {
  const p = record.payload ?? {};
  const time = timestamp(record.timestamp);
  if (Number.isFinite(time)) s.updatedAt = time;
  if (record.type === 'session_meta') {
    s.id = p.id ?? p.session_id;
    s.parentId = p.parent_thread_id ?? p.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
    s.name = p.agent_nickname ?? p.agent_path ?? s.id?.slice(0, 8) ?? 'Session';
    s.role = p.agent_role ?? (typeof p.source === 'object' ? p.source?.subagent?.other : '') ?? '';
    s.cwd = p.cwd ?? '';
  }
  if (record.type === 'turn_context') s.model = p.model ?? s.model;
  if (record.type === 'event_msg') {
    if (p.type === 'task_started') {
      s.status = 'running'; s.startedAt = timestamp(p.started_at ?? record.timestamp);
      s.context = { ...s.context, window: number(p.model_context_window) };
    }
    if (p.type === 'task_complete') s.status = 'completed';
    if (p.type === 'turn_aborted') s.status = 'interrupted';
    if (p.type === 'token_count' && p.info) {
      const info = p.info;
      // Cumulative usage counts repeated context. Never use it as context occupancy.
      const used = number(info.last_token_usage?.total_tokens);
      const window = number(info.model_context_window) ?? s.context?.window;
      s.context = { used, window, percent: used !== null && window > 0 ? Math.round(used / window * 100) : null, estimated: true };
      s.usage = info.total_token_usage ?? null;
      s.limits = p.rate_limits ?? null;
    }
  }
  if (record.type !== 'response_item') return;
  if (['function_call', 'custom_tool_call'].includes(p.type)) {
    const call = { id: p.call_id, name: p.name ?? 'outil', status: 'running', at: Number.isFinite(time) ? time : null };
    s.calls.set(p.call_id, call); s.activities.push(call);
    let args;
    try { args = JSON.parse(p.arguments ?? '{}'); } catch { args = {}; }
    // Only explicit structured edit paths and apply_patch headers are collected.
    const paths = [];
    if (/^(write_file|edit_file|write|edit)$/i.test(p.name ?? '')) {
      const value = args.path ?? args.file_path;
      if (typeof value === 'string') paths.push(value);
    }
    if (/apply_patch/.test(p.name ?? '')) {
      for (const match of String(p.input ?? args.patch ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) paths.push(match[1]);
    }
    for (const value of paths) if (!s.files.includes(value)) s.files.push(value);
    if (s.activities.length > 80) {
      const removed = s.activities.shift(); s.calls.delete(removed.id);
    }
    s.files = s.files.slice(-100);
  }
  if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    const call = s.calls.get(p.call_id);
    if (call) {
      let output;
      try { output = typeof p.output === 'string' ? JSON.parse(p.output) : p.output; } catch { /* plain output */ }
      call.status = output?.isError === true || (typeof output?.exit_code === 'number' && output.exit_code !== 0) ? 'failed' : 'completed';
    }
  }
}

async function discover(root) {
  const result = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    // Codex uses YYYY/MM/DD directories. Scan newest days first.
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      if (result.length >= MAX_FILES) break;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file);
    }
  }
  await walk(root, 0);
  return result;
}

export class SessionStore {
  constructor(root) { this.root = root; this.cache = new Map(); }
  async read(file) {
    const st = await stat(file);
    let cached = this.cache.get(file);
    if (cached && st.size === cached.offset) return cached.session;
    if (!cached || st.size < cached.offset) cached = { offset: 0, session: emptySession(file) };
    // Bound each refresh to 8 MiB; subsequent refreshes continue from the cursor.
    const end = Math.min(st.size, cached.offset + 8 * 1024 * 1024);
    if (end === cached.offset) return cached.session;
    const handle = await open(file, 'r');
    let bytes;
    try { bytes = Buffer.alloc(end - cached.offset); await handle.read(bytes, 0, bytes.length, cached.offset); }
    finally { await handle.close(); }
    const last = bytes.lastIndexOf(10);
    if (last < 0) {
      if (bytes.length >= MAX_LINE) { cached.offset = end; cached.session.partial = true; }
    } else {
      for (const line of bytes.subarray(0, last).toString('utf8').split('\n')) {
        if (line.length > MAX_LINE) { cached.session.partial = true; continue; }
        try { applyRecord(cached.session, JSON.parse(line)); } catch { cached.session.partial = true; }
      }
      cached.offset += last + 1;
    }
    cached.session.catchingUp = cached.offset < st.size;
    this.cache.set(file, cached);
    return cached.session;
  }
  async snapshot(id) {
    const files = await discover(this.root);
    let unreadable = 0;
    const sessions = [];
    // Sequential reads bound file descriptors and startup memory.
    for (const file of files) {
      try { const s = await this.read(file); if (s.id) sessions.push(s); } catch { unreadable++; }
    }
    const keep = new Set(files);
    for (const file of this.cache.keys()) if (!keep.has(file)) this.cache.delete(file);
    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const roots = sessions.filter(s => !s.parentId);
    const selected = id ? sessions.find(s => s.id === id) : roots[0];
    const descendants = new Set(selected ? [selected.id] : []);
    for (let i = 0; i < sessions.length; i++) {
      let changed = false;
      for (const s of sessions) if (descendants.has(s.parentId) && !descendants.has(s.id)) { descendants.add(s.id); changed = true; }
      if (!changed) break;
    }
    const clean = s => {
      const { file, calls, ...publicSession } = s;
      // Log state is historical evidence, not proof a process is still alive.
      return { ...publicSession, stale: s.status === 'running' && Date.now() - (s.updatedAt ?? 0) > 120_000 };
    };
    return {
      generatedAt: Date.now(), source: 'local-rollout', maxSessions: MAX_FILES, unreadable,
      sessions: roots.map(s => ({ id: s.id, name: s.name, cwd: s.cwd, status: s.status })),
      selected: selected ? clean(selected) : null,
      agents: sessions.filter(s => s.id !== selected?.id && descendants.has(s.id)).map(clean),
    };
  }
}

export async function replay(file) {
  const s = emptySession(file);
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    try { applyRecord(s, JSON.parse(line)); } catch { s.partial = true; }
  }
  return s;
}
