export const demoStore = {
  async snapshot() {
    const now = Date.now();
    const selected = { id: 'demo', name: 'Démonstration', status: 'running', startedAt: now - 82000, updatedAt: now,
      context: { used: 429000, window: 1000000, percent: 43, estimated: true }, stale: false };
    return { generatedAt: now, source: 'demo', selected,
      agents: [{ id: 'a', name: 'Agent 1', role: 'interface', status: 'running', startedAt: now - 60000, updatedAt: now }, { id: 'b', name: 'Agent 2', role: 'tests', status: 'running', startedAt: now - 40000, updatedAt: now }, { id: 'c', name: 'Agent 3', role: 'revue', status: 'completed', startedAt: now - 90000, updatedAt: now - 30000 }] };
  },
};
