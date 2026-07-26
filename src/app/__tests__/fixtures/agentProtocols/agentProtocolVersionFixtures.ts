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
const operations = {
    command: ['validate', 'execute', 'preview'],
    query: ['execute', 'resolve'],
    receipt: ['record', 'read'],
    provider: ['complete', 'stream'],
    'device-manifest': ['describe'],
    'production-brief': ['read', 'update'],
    transform: ['compile'],
    'external-adapter': ['connect', 'invoke'],
} as const;
export const agentProtocolDescriptorGolden = protocolFixtures.map(([family, semanticOwner, previous]) => ({
    id: `sourdaw.agent.${family}`,
    family,
    semanticOwner,
    schemaVersion: 1,
    requiredCapabilities: capabilities[family],
    supportedCapabilities: [],
    requiredOperationVersions: Object.fromEntries(
        operations[family].map((operation) => [`agent.${family}.${operation}`, [1]])
    ),
    supportedOperationVersions: {},
    compatibility: {
        minimumReadableVersion: 0,
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
export const agentProjectHydrationFixture = {
    projectMeta: { name: 'Materialized Mix', createdAt: 1, updatedAt: 2, keyRoot: 0, scaleName: 'chromatic' },
    tracks: { tracks: [] },
    chordTrack: { enabled: false, events: {} },
    actionHistory: {
        entries: [{ id: 'x', label: 'x', actionKind: 'obsolete.x', source: 'ai', timestamp: 1, reverted: false }],
    },
} as const;
