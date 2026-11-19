import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { SessionStore, emptySession, applyRecord } from '../src/sessions.mjs';
import { startServer } from '../src/server.mjs';
import { serveMcp } from '../src/mcp.mjs';
import { demoStore } from '../src/demo.mjs';

const record = (type, payload) => ({ type, timestamp: '2026-01-01T12:00:00Z', payload });
const line = r => JSON.stringify(r) + '\n';

test('context occupancy uses last call, never cumulative billing usage', () => {
  const s = emptySession('');
  applyRecord(s, record('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 900000 }, last_token_usage: { total_tokens: 43000 }, model_context_window: 100000 } }));
  assert.equal(s.context.percent, 43);
  assert.equal(s.usage.total_tokens, 900000);
  applyRecord(s, record('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 999999 }, model_context_window: 100000 } }));
  assert.equal(s.context.percent, null);
});

test('tracks lifecycle, structured failures, edits; drops prompts and raw output', () => {
  const s = emptySession('');
  applyRecord(s, record('event_msg', { type: 'task_started', started_at: 1700000000 }));
  applyRecord(s, record('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: '1', input: '*** Update File: src/a.js\nPRIVATE-PROMPT' }));
  applyRecord(s, record('response_item', { type: 'custom_tool_call_output', call_id: '1', output: '{"exit_code":1,"output":"SECRET"}' }));
  assert.deepEqual(s.files, ['src/a.js']);
  assert.equal(s.activities[0].status, 'failed');
  assert.equal(s.startedAt, 1700000000000);
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  assert.ok(!JSON.stringify(s).includes('PRIVATE-PROMPT'));
  applyRecord(s, record('event_msg', { type: 'turn_aborted' }));
  assert.equal(s.status, 'interrupted');
});

test('incremental reader waits for partial lines, follows explicit descendants and resets truncated logs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cockpit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, '2026/01/01'); await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'root.jsonl');
  const meta = line(record('session_meta', { id: 'root', cwd: '/example' }));
  await writeFile(file, meta + '{"type":"event_msg","payload":');
  await writeFile(path.join(dir, 'child.jsonl'), line(record('session_meta', { id: 'child', parent_thread_id: 'root', agent_nickname: 'Sol' })));
  await writeFile(path.join(dir, 'grandchild.jsonl'), line(record('session_meta', { id: 'grandchild', parent_thread_id: 'child' })));
  await writeFile(path.join(dir, 'unrelated.jsonl'), line(record('session_meta', { id: 'other', cwd: '/example' })));
  const store = new SessionStore(root);
  let snapshot = await store.snapshot('root');
  assert.equal(snapshot.selected.status, 'unknown');
  assert.deepEqual(snapshot.agents.map(a => a.id).sort(), ['child', 'grandchild']);
  await appendFile(file, '{"type":"task_complete"}}\n');
  snapshot = await store.snapshot('root');
  assert.equal(snapshot.selected.status, 'completed');
  assert.ok(!JSON.stringify(snapshot).includes('root.jsonl'));
  await writeFile(file, meta);
  snapshot = await store.snapshot('root');
  assert.equal(snapshot.selected.status, 'unknown');
  assert.equal((await store.snapshot('missing')).selected, null);
});

test('missing session directories yield an empty state', async () => {
  const result = await new SessionStore('/tmp/cockpit-directory-does-not-exist').snapshot();
  assert.equal(result.selected, null); assert.deepEqual(result.agents, []);
});

test('HTTP authenticates metrics and rejects foreign origins, hosts and writes', async t => {
  const cockpit = await startServer(demoStore);
  t.after(() => cockpit.close());
  const url = new URL(cockpit.url); const token = url.hash.slice(1); const base = url.origin;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/api/snapshot')).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await (await fetch(base + '/api/snapshot', { headers })).json()).source, 'demo');
  assert.equal((await fetch(base + '/api/snapshot', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(base + '/api/snapshot', { headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(base + '/api/snapshot', { method: 'POST', headers })).status, 405);
  const response = await fetch(base + '/app.js');
  assert.ok(response.headers.get('Content-Security-Policy').includes("default-src 'self'"));
  assert.equal((await fetch(base + '/src/cli.mjs')).status, 404);
});

test('MCP initialization, notification, tool calls, invalid arguments and EOF cleanup', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  let data = ''; output.on('data', chunk => { data += chunk; });
  let closed = false;
  serveMcp({ url: 'http://127.0.0.1/#test', snapshot: () => demoStore.snapshot(), close: async () => { closed = true; } }, input, output);
  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'open_cockpit' } },
    { id: 4, method: 'tools/call', params: { name: 'cockpit_snapshot', arguments: { session: 123 } } },
    { id: 5, method: 'tools/call', params: { name: 'cockpit_snapshot', arguments: {} } },
    null,
  ];
  input.end(requests.map(r => JSON.stringify(r)).join('\n') + '\n');
  for (let n = 0; n < 50 && !closed; n++) await new Promise(resolve => setTimeout(resolve, 10));
  const replies = data.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length, 6);
  assert.equal(replies[0].result.serverInfo.name, 'codex-cockpit');
  assert.equal(replies[1].result.tools.length, 2);
  assert.equal(replies[2].result.content[0].text, 'http://127.0.0.1/#test');
  assert.equal(replies[3].error.code, -32602);
  assert.equal(replies[4].result.structuredContent.source, 'demo');
  assert.equal(replies[5].error.code, -32600);
  assert.ok(closed);
});
