import { type AgentExecutionMode } from './AgentExecutionMode';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type AiBackendPreference, type RunnableAiBackend } from './LlmOrchestrationTypes';

export const AGENT_RUN_SCHEMA_VERSION = 1 as const;

export const AGENT_RUN_PHASES = [
    'created',
    'planning',
    'waiting-for-approval',
    'previewing',
    'executing',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'partially-completed',
] as const;

export type AgentRunPhase = (typeof AGENT_RUN_PHASES)[number];

export type AgentRunScope = {
    targetIds: string[];
    targetRanges: Array<{ startBeat: number; endBeat: number }>;
    protectedTargetIds: string[];
    protectedRanges: Array<{ startBeat: number; endBeat: number }>;
};

export type AgentRunGrants = {
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

export type AgentRunBudgets = {
    limits: Record<string, number>;
    consumed: Record<string, number>;
};

export type AgentRunPlan = {
    summary: string;
    commandIds: string[];
    serializedBatchIdentity: string | null;
    applicationToolReceipts?: ApplicationToolReceipt[];
};

export type AgentRunBatch = {
    batchId: string;
    commandIds: string[];
    status:
        'planned' | 'waiting-for-approval' | 'previewed' | 'executing' | 'committed' | 'no-op' | 'failed' | 'cancelled';
    receiptIdentity: string | null;
};

export type AgentRunReceipt = {
    workId: string;
    receiptIdentity: string;
    revertGroupId: string | null;
    committedAt: number;
};

export type AgentRunArtifact = {
    artifactId: string;
    workId: string;
    status: 'pending' | 'completed' | 'failed';
    summary: string | null;
};

export type AgentRunProviderUsage = {
    attempt?: number;
    provider: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    provenance: 'provider-reported' | 'versioned-estimate' | 'unavailable';
    correlationId?: string;
    status?: 'complete' | 'partial' | 'failed' | 'cancelled' | 'unavailable';
    retryable?: boolean | null;
    partialOutputDisposition?: 'none' | 'preserve' | 'discard';
    routeId?: string;
    executor?: RunnableAiBackend;
    fallbackReason?: string | null;
    selected?: boolean;
};

export type AgentRunModelRoute = {
    requestedRoute: AiBackendPreference | 'legacy-unknown';
    selectedRouteId: string | null;
};

export type AgentRunError = {
    code: string;
    message: string;
    occurredAt: number;
    retriable: boolean;
    workId: string | null;
};

export type AgentRunCancellation = {
    generation: number;
    requestedAt: number | null;
    reason: string | null;
    consumerAcknowledgedAt: number | null;
    transportAcknowledgedAt: number | null;
    backendAcknowledgedAt: number | null;
};

export type AgentRunCommittedWork = {
    workId: string;
    receiptIdentity: string;
    revertGroupId: string | null;
    committedAt: number;
};

export type AgentRunRetriableWork = {
    workId: string;
    idempotencyKey: string;
    receiptIdentity: string;
    idempotent: boolean;
    retriable: boolean;
};

export type AgentRunTemporaryAsset = {
    assetId: string;
    kind: 'render' | 'analysis' | 'import' | 'other';
    cleanupOwner: string;
    status: 'live' | 'cleanup-pending' | 'released';
    createdAt: number;
};

export type AgentRunManualResume = {
    required: boolean;
    reason: string | null;
    workIds: string[];
    requiredAt: number | null;
};

export type AgentRunWorkOwnerKind = 'provider' | 'command' | 'render' | 'analysis' | 'cleanup';

export type AgentRunWorkTerminalState = 'completed' | 'failed' | 'cancelled' | 'orphaned';

export type AgentRunWorkLease = {
    leaseId: string;
    runId: string;
    workId: string;
    attempt: number;
    ownerKind: AgentRunWorkOwnerKind;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    cleanupOwner: string;
    idempotent: boolean;
    retriable: boolean;
    claimedAt: number;
    terminalState: AgentRunWorkTerminalState | null;
    settledAt: number | null;
};

export type AgentRun = {
    schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
    runId: string;
    request: string;
    mode: AgentExecutionMode;
    phase: AgentRunPhase;
    revisions: {
        created: string | null;
        planned: string | null;
        approved: string | null;
        committed: string | null;
    };
    scope: AgentRunScope;
    grants: AgentRunGrants;
    budgets: AgentRunBudgets;
    plan: AgentRunPlan | null;
    batches: AgentRunBatch[];
    receipts: AgentRunReceipt[];
    renders: AgentRunArtifact[];
    analyses: AgentRunArtifact[];
    modelRoute: AgentRunModelRoute;
    providerUsage: AgentRunProviderUsage[];
    errors: AgentRunError[];
    cancellation: AgentRunCancellation;
    committedWork: AgentRunCommittedWork[];
    retriableWork: AgentRunRetriableWork[];
    temporaryAssets: AgentRunTemporaryAsset[];
    manualResume: AgentRunManualResume;
    workLeases: AgentRunWorkLease[];
    createdAt: number;
    updatedAt: number;
};

export type AgentRunState = {
    schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
    runs: AgentRun[];
};
