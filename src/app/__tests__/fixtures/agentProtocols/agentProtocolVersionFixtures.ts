const protocolFixtures = [
    ['command', 'Command', 'migrate', 0],
    ['query', 'Project', 'read-only-preserve', 1],
    ['receipt', 'Command', 'read-only-preserve', 1],
    ['provider', 'AiRuntime', 'read-only-preserve', 1],
    ['device-manifest', 'DeviceModules', 'read-only-preserve', 1],
    ['production-brief', 'Project', 'read-only-preserve', 1],
    ['transform', 'Command', 'read-only-preserve', 1],
    ['external-adapter', 'AgentAdapters', 'read-only-preserve', 1],
] as const;
const capabilities = {
    command: ['validated-envelope', 'descriptor-discovery', 'typed-outcome'],
    query: ['bounded-query', 'evidence-backed-resolution'],
    receipt: ['terminal-outcome', 'revision-correlation'],
    provider: ['text-completion', 'tool-calling', 'streaming'],
    'device-manifest': ['semantic-parameters', 'operation-discovery'],
    'production-brief': ['intent-read', 'decision-update'],
    transform: ['deterministic-lowering', 'bounded-expansion'],
    'external-adapter': ['capability-discovery', 'revision-bound-invocation'],
} as const;
const ops = {
    command: ['validate', 'execute', 'preview'],
    query: ['execute', 'resolve'],
    receipt: ['record', 'read'],
    provider: ['complete', 'stream'],
    'device-manifest': ['describe'],
    'production-brief': ['read', 'update'],
    transform: ['compile'],
    'external-adapter': ['connect', 'invoke'],
} as const;
export const protocolGolden = protocolFixtures.map(([family, semanticOwner, previous, minimumReadableVersion]) => ({
    id: `sourdaw.agent.${family}`,
    family,
    semanticOwner,
    schemaVersion: 1,
    requiredCapabilities: capabilities[family],
    supportedCapabilities: [],
    requiredOperationVersions: Object.fromEntries(ops[family].map((op) => [`agent.${family}.${op}`, [1]])),
    supportedOperationVersions: {},
    compatibility: {
        minimumReadableVersion,
        previous,
        current: 'read-write',
        future: 'read-only-preserve',
        unknownFields: 'preserve',
    },
    availability: {
        state: 'governance-only',
        detail: 'SA-00 publishes the contract only; a downstream owner must admit runtime behavior.',
    },
}));
export const projectFixture = {
    projectMeta: { name: 'Materialized Mix', createdAt: 1, updatedAt: 2, keyRoot: 0, scaleName: 'chromatic' },
    tracks: { tracks: [] },
    chordTrack: { enabled: false, events: {} },
    actionHistory: {
        entries: [{ id: 'x', label: 'x', actionKind: 'obsolete.x', source: 'ai', timestamp: 1, reverted: false }],
    },
} as const;
