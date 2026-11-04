import { type ThreadContextEvidence } from './ThreadContext';

export const AGENT_CONTEXT_SCHEMA_VERSION = 2 as const;

/**
 * Receipt summaries carry application-owned tool evidence, not imported project or prompt text, so
 * they hold their own budget instead of the general imported-string bound. The budget is the total
 * across every retained receipt, which keeps the worst-case message contribution identical to the
 * previous MAX_RECEIPTS * MAX_IMPORTED_STRING_LENGTH aggregate while letting a single receipt spend
 * the whole allowance. This constant is the only owner of that budget: callers pass whole summaries
 * and read the reported `truncated` flag.
 */
export const AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS = 8_192;

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
    masterGain: number;
    masterGainDb: number | null;
    selectedTrack: { id: string; digest: string } | null;
    selectableTargets: Array<{ id: string; digest: string }>;
    automationLanes: Array<{ id: string; digest: string }>;
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
        /** What each profile's `thread_context` section kept, present only when the request had thread state. */
        thread?: { hosted: ThreadContextEvidence; local: ThreadContextEvidence };
    };
    snapshot: AgentContextProjectSnapshot;
    delta: { mode: 'full' | 'delta'; baseRevision: string | null; currentRevision: string | null };
};
