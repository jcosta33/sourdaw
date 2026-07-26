const protocolFixtures = [
    ['command', 'Command', 'migrate'],
    ['query', 'Project', 'read-only-preserve'],
    ['receipt', 'Command', 'read-only-preserve'],
    ['provider', 'AiRuntime', 'read-only-preserve'],
    ['device-manifest', 'DeviceModules', 'read-only-preserve'],
    ['production-brief', 'Project', 'read-only-preserve'],
    ['transform', 'Command', 'read-only-preserve'],
    ['external-adapter', 'AgentAdapters', 'read-only-preserve'],
] as const;

export const agentProtocolOwnerFixtures = protocolFixtures.map(([family, owner]) => ({
    id: `sourdaw.agent.${family}`,
    owner,
}));

export const agentProtocolVersionFixtures = protocolFixtures.flatMap(([family, , previous]) => {
    const id = `sourdaw.agent.${family}`;
    return [
        { id, version: 0, expected: previous },
        { id, version: 1, expected: 'read-write' },
        { id, version: 2, expected: 'read-only-preserve' },
    ];
});

export const agentProjectHydrationFixture = {
    projectMeta: { name: 'Materialized Mix', createdAt: 1, updatedAt: 2, keyRoot: 0, scaleName: 'chromatic' },
    tracks: { tracks: [] },
    chordTrack: { enabled: false, events: {} },
    actionHistory: {
        entries: [{ id: 'x', label: 'x', actionKind: 'obsolete.x', source: 'ai', timestamp: 1, reverted: false }],
    },
    agentProtocolAudit: {
        bytes: [17, 34, 51],
        rows: [{ id: 'sourdaw.agent.runtime-action', schemaVersion: 0 }],
    },
} as const;
