export const demoStore = {
  async snapshot() {
    const now = Date.now();
    const selected = { id: 'demo', name: 'Démonstration', cwd: 'projet-exemple', model: 'modèle exemple', status: 'running', startedAt: now - 82000, updatedAt: now,
      context: { used: 429000, window: 1000000, percent: 43, estimated: true }, usage: { total_tokens: 527000 }, limits: null,
      files: ['src/cockpit.ts', 'README.md', 'test/cockpit.test.ts'], activities: [
        { id: '1', name: 'read_file', status: 'completed' }, { id: '2', name: 'apply_patch', status: 'completed' }, { id: '3', name: 'exec_command', status: 'running' }], stale: false };
    return { generatedAt: now, source: 'demo', sessions: [{ id: 'demo', name: 'Démonstration', cwd: 'projet-exemple' }], selected,
      agents: [{ id: 'a', name: 'astra', role: 'interface', status: 'running', startedAt: now - 60000, updatedAt: now }, { id: 'b', name: 'sol', role: 'tests', status: 'running', startedAt: now - 40000, updatedAt: now }, { id: 'c', name: 'neon', role: 'revue', status: 'completed', startedAt: now - 90000, updatedAt: now - 30000 }] };
  },
};
