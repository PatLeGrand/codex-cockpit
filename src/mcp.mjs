import { createInterface } from 'node:readline';

export function serveMcp(cockpit, input = process.stdin, output = process.stdout) {
  const tools = [
    { name: 'open_cockpit', description: 'Open context and sub-agents for the current Codex conversation. Requires its exact session ID; never follows the most recent session.', inputSchema: { type: 'object', properties: { session: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['session'], additionalProperties: false } },
    { name: 'cockpit_snapshot', description: 'Read only context estimates and sub-agent states for the specified conversation.', inputSchema: { type: 'object', properties: { session: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['session'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  ];
  const send = value => output.write(JSON.stringify(value) + '\n');
  const lines = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  async function handle(line) {
    let req;
    try { req = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (!req || typeof req !== 'object' || Array.isArray(req)) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return; }
    if (req.id === undefined) return;
    const reply = result => send({ jsonrpc: '2.0', id: req.id, result });
    const error = (code, message) => send({ jsonrpc: '2.0', id: req.id, error: { code, message } });
    try {
      switch (req.method) {
        case 'initialize': return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-cockpit', version: '0.4.0' } });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools });
        case 'tools/call': {
          const args = req.params?.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args)) return error(-32602, 'Invalid arguments');
          if (req.params?.name === 'open_cockpit') {
            if (Object.keys(args).some(k => k !== 'session') || typeof args.session !== 'string' || !args.session.trim() || args.session.length > 200) return error(-32602, 'The current conversation session ID is required');
            const url = new URL(cockpit.url); url.searchParams.set('session', args.session);
            return reply({ content: [{ type: 'text', text: url.href }] });
          }
          if (req.params?.name === 'cockpit_snapshot') {
            if (Object.keys(args).some(k => k !== 'session') || typeof args.session !== 'string' || !args.session.trim() || args.session.length > 200) return error(-32602, 'The current conversation session ID is required');
            const data = await cockpit.snapshot(args.session);
            return reply({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
          }
          return error(-32602, 'Unknown tool');
        }
        default: return error(-32601, 'Method not found');
      }
    } catch { error(-32603, 'Cockpit could not read local sessions'); }
  }
  lines.on('line', line => { queue = queue.then(() => handle(line)); });
  lines.on('close', () => { queue.finally(() => cockpit.close()); });
  return lines;
}
