import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { activeNayAgents, NayMonitor, readProcesses } from '../src/nay.mjs';
import { SessionStore } from '../src/sessions.mjs';

const processes = [
  { pid: 10, parentPid: 1, action: 'run', agent: 'sol', callerSessionId: 'chat-a', startKey: '100' },
  { pid: 11, parentPid: 10, provider: 'codex', model: 'sol-model', startKey: '101' },
  { pid: 20, parentPid: 1, action: 'run', agent: 'sol', callerSessionId: 'chat-b', startKey: '200' },
  { pid: 30, parentPid: 1, action: 'story', callerSessionId: 'chat-a', startKey: '300' },
  { pid: 31, parentPid: 30, provider: 'codex', model: 'astra-model', startKey: '301' },
  { pid: 32, parentPid: 31, provider: 'codex', model: 'astra-model', startKey: '302' },
  { pid: 33, parentPid: 30, provider: 'agy', model: 'neon-high', startKey: '303' },
  { pid: 40, parentPid: 1, action: 'resume', callerSessionId: 'chat-a', startKey: '400' },
  { pid: 41, parentPid: 40, provider: 'claude', model: 'sonnet-model', startKey: '401' },
  { pid: 50, parentPid: 1, action: 'run', agent: 'terra', callerSessionId: null, startKey: '500' },
];
const models = { astra: { cli: 'codex', model: 'astra-model' }, sonnet: { cli: 'claude', model: 'sonnet-model' }, neon: { cli: 'agy', model: 'neon-{effort}', effort: 'medium' } };

test('links run/story/resume to the exact chat, recognizes models and deduplicates CLI wrappers', () => {
  const agents = activeNayAgents(processes, new Set(['chat-a']), models);
  assert.deepEqual(agents.map(a => a.name), ['sol', 'astra', 'neon', 'sonnet']);
  assert.ok(agents.every(a => a.source === 'nay' && a.status === 'running' && !a.stale && a.parentId === 'chat-a'));
  assert.deepEqual(activeNayAgents(processes, new Set(['chat-b']), models).map(a => a.id), ['nay:20:200']);
  assert.deepEqual(activeNayAgents(processes, new Set(['unknown']), models), []);
  assert.deepEqual(activeNayAgents([], new Set(['chat-a']), models), []);
});

test('does not invent an alias if multiple configured names share a model', () => {
  const agents = activeNayAgents(processes, new Set(['chat-a']), { ...models, alternate: models.astra });
  assert.ok(agents.some(a => a.name === 'astra-model'));
});

test('reports unavailable process metadata rather than inventing Nay workers', async () => {
  const monitor = new NayMonitor({ processes: async () => { throw new Error('denied'); } });
  assert.deepEqual(await monitor.active(new Set(['root'])), { agents: [], available: false });
});

test('detects a real harmless Nay-shaped process and removes it when it exits', { skip: process.platform !== 'linux' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cockpit-nay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'nay.js');
  await writeFile(script, 'process.stdout.write("ready\\n");setInterval(()=>{},1000);');
  const child = spawn(process.execPath, [script, 'run', 'sonnet', '-'], {
    env: { ...process.env, CODEX_THREAD_ID: 'synthetic-chat', CODEX_SESSION_ID: 'synthetic-chat' }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  await once(child.stdout, 'data');
  const monitor = new NayMonitor();
  const result = await monitor.active(new Set(['synthetic-chat']));
  assert.deepEqual(result.agents.map(a => a.name), ['sonnet']);
  assert.equal(result.agents[0].source, 'nay');
  assert.deepEqual((await monitor.active(new Set(['different-chat']))).agents, []);
  const exited = once(child, 'exit'); child.kill(); await exited;
  assert.deepEqual((await monitor.active(new Set(['synthetic-chat']))).agents, []);
});

test('readProcesses excludes zombies, retains exact session identity and drops prompts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cockpit-proc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [pid, state] of [[101, 'S'], [102, 'Z']]) {
    const dir = path.join(root, String(pid)); await mkdir(dir);
    await writeFile(path.join(dir, 'stat'), `${pid} (name with spaces) ${state} 1 ${Array(17).fill(0).join(' ')} 12345`);
    await writeFile(path.join(dir, 'cmdline'), 'node\0/example/nay.js\0run\0sol\0PRIVATE-PROMPT\0');
    await writeFile(path.join(dir, 'environ'), 'CODEX_THREAD_ID=chat-a\0PRIVATE_SECRET=secret-value\0');
  }
  const found = await readProcesses(root);
  assert.equal(found.length, 1); assert.equal(found[0].callerSessionId, 'chat-a');
  assert.equal(found[0].startKey, '12345');
  assert.ok(!JSON.stringify(found).includes('PRIVATE-PROMPT'));
  assert.ok(!JSON.stringify(found).includes('secret-value'));
});

test('snapshot includes Nay workers from this chat and its explicit Codex descendants', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cockpit-merge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const line = payload => JSON.stringify({ type: 'session_meta', payload }) + '\n';
  await writeFile(path.join(root, 'root.jsonl'), line({ id: 'chat-a' }));
  await writeFile(path.join(root, 'child.jsonl'), line({ id: 'child', parent_thread_id: 'chat-a' }));
  const requested = [];
  const store = new SessionStore(root, { nay: { async active(ids) { requested.push([...ids].sort()); return { agents: activeNayAgents(processes, ids, models), available: true }; } } });
  const snapshot = await store.snapshot('chat-a');
  assert.deepEqual(requested[0], ['chat-a', 'child']);
  assert.equal(snapshot.agents.filter(a => a.source === 'nay').length, 4);
  assert.equal(snapshot.agents.filter(a => a.source === 'codex').length, 1);
  assert.ok(snapshot.agents.every(a => a.parentId !== 'chat-b'));
});
