import { type AgentContextEvidence } from './AgentContext';
import { type AgentExecutionMode } from './AgentExecutionMode';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type AiBackendPreference, type RunnableAiBackend } from './LlmOrchestrationTypes';
import { type ProviderRequestTokenCeilingMethod } from './ModelProviderBudgetEstimate';

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

export type AgentRunBudgetEstimateMethod = ProviderRequestTokenCeilingMethod;

export type AgentRunBudgetAttempt = {
    attemptId: string;
    category: string;
    reserved: number;
    actual: number;
    provenance: 'provider-reported' | 'versioned-estimate' | 'unavailable';
    estimateMethod?: AgentRunBudgetEstimateMethod;
    final: boolean;
};

export type AgentRunPlan = {
    summary: string;
    commandIds: string[];
    serializedBatchIdentity: string | null;
    applicationToolReceipts?: ApplicationToolReceipt[];
    revision: string | null;
    classification: 'simple' | 'complex';
    showPlanPanel: boolean;
    objective: string;
    interpretedConstraints: string[];
    scope: AgentRunScope;
    steps: AgentRunPlanStep[];
    expectedImpact: AgentRunPlanExpectedImpact;
    capabilities: AgentRunPlanCapability[];
    risks: string[];
    approvalPoints: AgentRunPlanApprovalPoint[];
    validationStrategy: string[];
    stoppingConditions: string[];
    alternatives: AgentRunPlanAlternative[];
    needsUserDecision: boolean;
};

export type AgentRunPlanStep = {
    order: number;
    actionType: string;
    description: string;
};

export type AgentRunPlanExpectedImpact = {
    project: string[];
    audible: { status: 'not-claimed'; reason: string };
};

export type AgentRunPlanCapability = {
    id: string;
    source: 'action-catalog' | 'application-tool-catalog' | 'budget' | 'asset' | 'data-policy';
    prerequisite: string;
    status: 'available' | 'required' | 'unavailable';
};

export type AgentRunPlanApprovalPoint = {
    kind: 'command-confirmation' | 'user-decision';
    reason: string;
};

export type AgentRunPlanAlternative = {
    id: string;
    label: string;
    changesAuthority: boolean;
};

export const AGENT_PLAN_UNCERTAINTY = [
    'ambiguous-target',
    'exploratory-outcome',
    'conflicted-constraints',
    'capability-mismatch',
] as const;

export type AgentPlanUncertainty = (typeof AGENT_PLAN_UNCERTAINTY)[number];

/**
 * Provider-authored intent evidence. It is inert until application-owned scope,
 * grants, budgets, and assets admit the corresponding command batch.
 */
export type AgentPlanProposal = {
    semantic: { classification: 'simple' | 'complex'; uncertainty: AgentPlanUncertainty[] };
    objective: string;
    constraints: string[];
    scope: AgentRunScope;
    capabilityIds: string[];
    assetIds: string[];
    alternatives: AgentRunPlanAlternative[];
    validationStrategy: string[];
    stoppingConditions: string[];
};

/** @deprecated Keep the persisted name stable while the proposal contract is shared by all providers. */
export type AgentRunProviderProposal = AgentPlanProposal;

export type AgentRunDecision = {
    decisionId: string;
    capabilitySchemaIdentity: string;
    proposalIdentity: string;
    budgets: AgentRunBudgets;
    revision: string;
    scope: AgentRunScope;
    grants: AgentRunGrants;
    alternatives: AgentRunPlanAlternative[];
    reason: string;
    selectedAlternativeId: string | null;
    resumeAttemptId: string | null;
};

/** Typed handoff evidence for a replacement planning attempt after a user decision. */
export type AgentRunDecisionResume = {
    sourceRunId: string;
    decisionId: string;
    selectedAlternativeId: string;
    selectedAlternative: AgentRunPlanAlternative;
    proposalIdentity: string;
    capabilitySchemaIdentity: string;
    revision: string;
    scope: AgentRunScope;
    grants: AgentRunGrants;
    budgets: AgentRunBudgets;
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
    cachedInputTokens?: number | null;
    provenance: 'provider-reported' | 'versioned-estimate' | 'unavailable';
    correlationId?: string;
    status?: 'complete' | 'partial' | 'failed' | 'cancelled' | 'unavailable';
    retryable?: boolean | null;
    partialOutputDisposition?: 'none' | 'preserve' | 'discard';
    routeId?: string;
    /** Historical execution evidence only; it is never an inference route. */
    executor?: RunnableAiBackend | 'legacy-unknown';
    fallbackReason?: string | null;
    disclosure?: {
        requestId: string;
        categories: string[];
        retention: {
            applicationState: 'unknown';
            abuseMonitoring: 'unknown';
            promptCache: 'unknown';
            safetyLegalException: 'unknown';
            unknown: 'unknown';
        };
    };
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
    /** Application-owned classification. Never contains provider output or secrets. */
    category?: AgentRunErrorCategory;
    related?: AgentRunErrorRelated;
    remediation?: AgentRunErrorRemediation;
    cause?: AgentRunErrorCause;
};

export const AGENT_RUN_ERROR_CATEGORIES = [
    'schema',
    'authorization',
    'resolution',
    'conflict',
    'project',
    'device',
    'plugin',
    'asset',
    'render',
    'analysis',
    'provider',
    'network',
    'budget',
    'cancellation',
    'internal',
] as const;
export type AgentRunErrorCategory = (typeof AGENT_RUN_ERROR_CATEGORIES)[number];
export type AgentRunErrorRelated = {
    targetIds: string[];
    commandIds: string[];
    workIds: string[];
    receiptIdentities: string[];
    artifactIds: string[];
};
export type AgentRunErrorRemediation = {
    retry: 'never' | 'read-only' | 'owner-proven-idempotent';
    userAction: 'none' | 'review-scope' | 'resolve-conflict' | 'retry-later' | 'manual-repair' | 'reconfigure';
    compensation: 'not-needed' | 'available' | 'attempted' | 'completed' | 'uncompensated' | 'manual-repair';
};
export type AgentRunErrorCause = { kind: 'known-domain' | 'unknown-internal'; source: string };

export const AGENT_RUN_SAGA_SCHEMA_VERSION = 1 as const;
export type AgentRunSagaStepState =
    'pending' | 'external-pending' | 'committed' | 'compensated' | 'uncompensated' | 'manual-repair';
export type AgentRunSagaStep = {
    stepId: string;
    order: number;
    owner: 'provider' | 'command' | 'render' | 'analysis' | 'import' | 'external-effect';
    workId: string;
    receiptIdentity: string | null;
    state: AgentRunSagaStepState;
    compensation: { available: boolean; attempts: number; lastError: string | null };
    relatedArtifactIds: string[];
    updatedAt: number;
};
export type AgentRunSaga = { schemaVersion: typeof AGENT_RUN_SAGA_SCHEMA_VERSION; steps: AgentRunSagaStep[] };

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
    budgetAttempts: AgentRunBudgetAttempt[];
    plan: AgentRunPlan | null;
    decision: AgentRunDecision | null;
    resume: AgentRunDecisionResume | null;
    batches: AgentRunBatch[];
    receipts: AgentRunReceipt[];
    renders: AgentRunArtifact[];
    analyses: AgentRunArtifact[];
    modelRoute: AgentRunModelRoute;
    providerUsage: AgentRunProviderUsage[];
    errors: AgentRunError[];
    saga: AgentRunSaga;
    cancellation: AgentRunCancellation;
    committedWork: AgentRunCommittedWork[];
    retriableWork: AgentRunRetriableWork[];
    temporaryAssets: AgentRunTemporaryAsset[];
    manualResume: AgentRunManualResume;
    workLeases: AgentRunWorkLease[];
    contextEvidence: AgentContextEvidence | null;
    createdAt: number;
    updatedAt: number;
};

export type AgentRunState = {
    schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
    runs: AgentRun[];
};
