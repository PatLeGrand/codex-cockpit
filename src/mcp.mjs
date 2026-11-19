import { createInterface } from 'node:readline';

export function serveMcp(cockpit, input = process.stdin, output = process.stdout) {
  const tools = [
    { name: 'open_cockpit', description: 'Return the private loopback URL of the local Codex context and agent Cockpit. Open this URL in a Codex browser panel.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'cockpit_snapshot', description: 'Read local Codex context estimates, agent states and tool activity. Does not return conversation messages or instructions.', inputSchema: { type: 'object', properties: { session: { type: 'string', maxLength: 200 } }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
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
        case 'initialize': return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-cockpit', version: '0.1.0' } });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools });
        case 'tools/call': {
          const args = req.params?.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args)) return error(-32602, 'Invalid arguments');
          if (req.params?.name === 'open_cockpit') {
            if (Object.keys(args).length) return error(-32602, 'No arguments expected');
            return reply({ content: [{ type: 'text', text: cockpit.url }] });
          }
          if (req.params?.name === 'cockpit_snapshot') {
            if (Object.keys(args).some(k => k !== 'session') || (args.session !== undefined && (typeof args.session !== 'string' || args.session.length > 200))) return error(-32602, 'Invalid session');
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
