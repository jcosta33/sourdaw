export const AGENT_CONTEXT_SCHEMA_VERSION = 1 as const;

export type AgentContextGrants = {
    allowedOperationPrefixes: string[];
    create: boolean;
    delete: boolean;
    routing: boolean;
    tempo: boolean;
    master: boolean;
    file: boolean;
    audioUpload: boolean;
    remoteGeneration: boolean;
    autoCommit: boolean;
};

export type AgentContextBudgets = {
    limits: Record<string, number>;
    consumed: Record<string, number>;
};

export type AgentContextProjectSnapshot = {
    identity: string;
    tempo: number;
    timeSignature: [number, number];
    selectedTrack: { id: string; digest: string } | null;
    selectableTargets: Array<{ id: string; digest: string }>;
    sections?: Array<{ id: string; digest: string }>;
    targetCount: number;
    truncated: boolean;
};

export type AgentContextEvidence = {
    schemaVersion: typeof AGENT_CONTEXT_SCHEMA_VERSION;
    revision: string | null;
    selection: { trackId: string | null; clipId: string | null; clipIds: string[] };
    grants: AgentContextGrants | null;
    budgets: AgentContextBudgets | null;
    included: {
        receiptCount: number;
        capabilitySchemaCount: number;
        validationFailures: { total: number; retained: number; omitted: number };
        measurementCount: number;
        trackCount: number;
    };
    snapshot: AgentContextProjectSnapshot;
    delta: { mode: 'full' | 'delta'; baseRevision: string | null; currentRevision: string | null };
};
