const protocolFamilies = [
    'command',
    'query',
    'receipt',
    'provider',
    'device-manifest',
    'production-brief',
    'transform',
    'external-adapter',
] as const;

export type AgentProtocolFamily = (typeof protocolFamilies)[number];
export type AgentProtocolId = `sourdaw.agent.${AgentProtocolFamily}`;
export type AgentProtocolOwner = 'Command' | 'Project' | 'AiRuntime' | 'DeviceModules' | 'AgentAdapters';
export type AgentProtocolVersionHandling = 'migrate' | 'read-write' | 'read-only-preserve';

export type AgentProtocolDescriptor = {
    readonly id: AgentProtocolId;
    readonly family: AgentProtocolFamily;
    readonly semanticOwner: AgentProtocolOwner;
    readonly schemaVersion: number;
    readonly capabilities: readonly string[];
    readonly operationVersions: Readonly<Record<string, readonly number[]>>;
    readonly compatibility: Readonly<{
        minimumReadableVersion: number;
        previous: 'migrate' | 'read-only-preserve';
        current: 'read-write';
        future: 'read-only-preserve';
        unknownFields: 'preserve';
    }>;
    readonly availability: Readonly<{
        state: 'governance-only';
        detail: string;
    }>;
};

type AgentProtocolDefinition = readonly [
    AgentProtocolOwner,
    readonly string[],
    readonly string[],
    ('migrate' | 'read-only-preserve')?,
];

function defineAgentProtocol(
    family: AgentProtocolFamily,
    [semanticOwner, capabilities, operations, previous = 'read-only-preserve']: AgentProtocolDefinition
): AgentProtocolDescriptor {
    const id: AgentProtocolId = `sourdaw.agent.${family}`;
    const operationVersions: Record<string, readonly number[]> = {};
    for (const operation of operations) {
        operationVersions[`agent.${family}.${operation}`] = Object.freeze([1]);
    }
    return Object.freeze({
        id,
        family,
        semanticOwner,
        schemaVersion: 1,
        capabilities: Object.freeze([...capabilities]),
        operationVersions: Object.freeze(operationVersions),
        compatibility: Object.freeze({
            minimumReadableVersion: 0,
            previous,
            current: 'read-write',
            future: 'read-only-preserve',
            unknownFields: 'preserve',
        }),
        availability: Object.freeze({
            state: 'governance-only',
            detail: 'SA-00 publishes the contract only; a downstream owner must admit runtime behavior.',
        }),
    });
}

const protocolDefinitions = {
    command: [
        'Command',
        ['validated-envelope', 'descriptor-discovery', 'typed-outcome'],
        ['validate', 'execute', 'preview'],
        'migrate',
    ],
    query: ['Project', ['bounded-query', 'evidence-backed-resolution'], ['execute', 'resolve']],
    receipt: ['Command', ['terminal-outcome', 'revision-correlation'], ['record', 'read']],
    provider: ['AiRuntime', ['text-completion', 'tool-calling', 'streaming'], ['complete', 'stream']],
    'device-manifest': ['DeviceModules', ['semantic-parameters', 'operation-discovery'], ['describe']],
    'production-brief': ['Project', ['intent-read', 'decision-update'], ['read', 'update']],
    transform: ['Command', ['deterministic-lowering', 'bounded-expansion'], ['compile']],
    'external-adapter': ['AgentAdapters', ['capability-discovery', 'revision-bound-invocation'], ['connect', 'invoke']],
} as const satisfies Record<AgentProtocolFamily, AgentProtocolDefinition>;

export const agentProtocolRegistry: readonly AgentProtocolDescriptor[] = Object.freeze(
    protocolFamilies.map((family) => defineAgentProtocol(family, protocolDefinitions[family]))
);

const protocolAliases: Readonly<Record<string, AgentProtocolId>> = Object.freeze({
    'sourdaw.agent.model-provider': 'sourdaw.agent.provider',
});
const protocolTombstones: Readonly<Record<string, { replacement: AgentProtocolId; handling: 'read-only-preserve' }>> =
    Object.freeze({
        'sourdaw.agent.runtime-action': Object.freeze({
            replacement: 'sourdaw.agent.command',
            handling: 'read-only-preserve',
        }),
    });

type ResolvePersistedAgentProtocolInput = {
    id: unknown;
    schemaVersion: unknown;
};

export type PersistedAgentProtocolResolution =
    | Readonly<{
          status: 'supported';
          persistedId: string;
          canonicalId: AgentProtocolId;
          protocol: AgentProtocolDescriptor;
          handling: AgentProtocolVersionHandling;
      }>
    | Readonly<{
          status: 'tombstoned';
          persistedId: string;
          replacement: AgentProtocolId;
          handling: 'read-only-preserve';
      }>
    | Readonly<{
          status: 'unsupported';
          reason: 'malformed-id' | 'malformed-version' | 'unknown-id';
          preservation: 'retain-bytes';
      }>;

const protocolIdPattern = /^sourdaw\.agent\.[a-z]+(?:-[a-z]+)*$/u;

export function resolvePersistedAgentProtocol({
    id,
    schemaVersion,
}: ResolvePersistedAgentProtocolInput): PersistedAgentProtocolResolution {
    if (typeof id !== 'string' || !protocolIdPattern.test(id)) {
        return { status: 'unsupported', reason: 'malformed-id', preservation: 'retain-bytes' };
    }
    if (!Number.isSafeInteger(schemaVersion) || Number(schemaVersion) < 0) {
        return { status: 'unsupported', reason: 'malformed-version', preservation: 'retain-bytes' };
    }
    const tombstone = protocolTombstones[id];
    if (tombstone) {
        return { status: 'tombstoned', persistedId: id, ...tombstone };
    }
    const canonicalId = protocolAliases[id] ?? id;
    const protocol = agentProtocolRegistry.find((candidate) => candidate.id === canonicalId);
    if (!protocol) {
        return { status: 'unsupported', reason: 'unknown-id', preservation: 'retain-bytes' };
    }
    let handling: AgentProtocolVersionHandling = protocol.compatibility.future;
    if (schemaVersion === protocol.schemaVersion) {
        handling = protocol.compatibility.current;
    } else if (Number(schemaVersion) < protocol.schemaVersion) {
        handling = protocol.compatibility.previous;
    }
    return { status: 'supported', persistedId: id, canonicalId: protocol.id, protocol, handling };
}

export const agentProjectStateCompatibility = Object.freeze({
    canonicalSource: 'materialized-project-state',
    obsoleteCommandHandling: 'audit-only',
    replayRequiredForLoad: false,
});
