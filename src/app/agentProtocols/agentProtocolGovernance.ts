export type AgentProtocolFamily =
    | 'command'
    | 'query'
    | 'receipt'
    | 'provider'
    | 'device-manifest'
    | 'production-brief'
    | 'transform'
    | 'external-adapter';

export type AgentProtocolVersionHandling = 'migrate' | 'read-write' | 'read-only-preserve' | 'unsupported';

export type AgentProtocolDescriptor = {
    id: `sourdaw.agent.${AgentProtocolFamily}`;
    family: AgentProtocolFamily;
    schemaVersion: number;
    schemaVersionOwner: `sourdaw.agent.${AgentProtocolFamily}`;
    capabilities: readonly string[];
    operationVersions: Readonly<Record<string, readonly number[]>>;
    compatibility: {
        minimumReadableVersion: number;
        previous: 'migrate' | 'read-only-preserve';
        current: 'read-write';
        future: 'read-only-preserve';
        unknownFields: 'preserve';
    };
    availability: {
        state: 'governance-only';
        detail: string;
    };
};

const governanceOnly = {
    state: 'governance-only',
    detail: 'SA-00 publishes the contract only; a downstream owner must admit runtime behavior.',
} as const;

const preservePreviousVersions = {
    minimumReadableVersion: 0,
    previous: 'read-only-preserve',
    current: 'read-write',
    future: 'read-only-preserve',
    unknownFields: 'preserve',
} as const;

export const agentProtocolRegistry: readonly AgentProtocolDescriptor[] = [
    {
        id: 'sourdaw.agent.command',
        family: 'command',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.command',
        capabilities: ['validated-envelope', 'descriptor-discovery', 'typed-outcome'],
        operationVersions: {
            'agent.command.validate': [1],
            'agent.command.execute': [1],
            'agent.command.preview': [1],
        },
        compatibility: { ...preservePreviousVersions, previous: 'migrate' },
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.query',
        family: 'query',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.query',
        capabilities: ['bounded-query', 'evidence-backed-resolution'],
        operationVersions: { 'agent.query.execute': [1], 'agent.query.resolve': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.receipt',
        family: 'receipt',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.receipt',
        capabilities: ['terminal-outcome', 'revision-correlation'],
        operationVersions: { 'agent.receipt.record': [1], 'agent.receipt.read': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.provider',
        family: 'provider',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.provider',
        capabilities: ['text-completion', 'tool-calling', 'streaming'],
        operationVersions: { 'agent.provider.complete': [1], 'agent.provider.stream': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.device-manifest',
        family: 'device-manifest',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.device-manifest',
        capabilities: ['semantic-parameters', 'operation-discovery'],
        operationVersions: { 'agent.device-manifest.describe': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.production-brief',
        family: 'production-brief',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.production-brief',
        capabilities: ['intent-read', 'decision-update'],
        operationVersions: { 'agent.production-brief.read': [1], 'agent.production-brief.update': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.transform',
        family: 'transform',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.transform',
        capabilities: ['deterministic-lowering', 'bounded-expansion'],
        operationVersions: { 'agent.transform.compile': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
    {
        id: 'sourdaw.agent.external-adapter',
        family: 'external-adapter',
        schemaVersion: 1,
        schemaVersionOwner: 'sourdaw.agent.external-adapter',
        capabilities: ['capability-discovery', 'revision-bound-invocation'],
        operationVersions: { 'agent.external-adapter.connect': [1], 'agent.external-adapter.invoke': [1] },
        compatibility: preservePreviousVersions,
        availability: governanceOnly,
    },
];

export const agentProjectStateCompatibility = {
    canonicalSource: 'materialized-project-state',
    obsoleteCommandHandling: 'audit-only',
    replayRequiredForLoad: false,
} as const;

type ClassifyAgentProtocolVersionInput = {
    protocol: AgentProtocolDescriptor;
    schemaVersion: number;
};

export function classifyAgentProtocolVersion({
    protocol,
    schemaVersion,
}: ClassifyAgentProtocolVersionInput): AgentProtocolVersionHandling {
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < protocol.compatibility.minimumReadableVersion) {
        return 'unsupported';
    }
    if (schemaVersion === protocol.schemaVersion) {
        return protocol.compatibility.current;
    }
    if (schemaVersion < protocol.schemaVersion) {
        return protocol.compatibility.previous;
    }
    return protocol.compatibility.future;
}
