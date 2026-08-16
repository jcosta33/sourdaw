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

export type AgentContextEvidence = {
    schemaVersion: typeof AGENT_CONTEXT_SCHEMA_VERSION;
    revision: string | null;
    selection: { trackId: string | null; clipId: string | null; clipIds: string[] };
    grants: AgentContextGrants | null;
    budgets: AgentContextBudgets | null;
    included: {
        receiptCount: number;
        capabilitySchemaCount: number;
        validationFailureCount: number;
        measurementCount: number;
        trackCount: number;
    };
    delta: { mode: 'full' | 'delta'; baseRevision: string | null };
};
