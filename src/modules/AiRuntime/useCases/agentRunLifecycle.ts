import { type AgentExecutionMode } from '../models/AgentExecutionMode';
import {
    AGENT_RUN_SCHEMA_VERSION,
    type AgentRun,
    type AgentRunArtifact,
    type AgentRunBatch,
    type AgentRunBudgetAttempt,
    type AgentRunBudgets,
    type AgentRunError,
    type AgentRunGrants,
    type AgentRunPhase,
    type AgentRunProviderUsage,
    type AgentRunScope,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type AiBackendPreference } from '../models/LlmOrchestrationTypes';
import { persistAgentRunState, readAgentRunState, resetAgentRunState } from '../stores/agentRunStore';

const DEFAULT_SCOPE: AgentRunScope = {
    targetIds: [],
    targetRanges: [],
    protectedTargetIds: [],
    protectedRanges: [],
};

const DEFAULT_GRANTS: AgentRunGrants = {
    allowedOperationPrefixes: [],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};

const DEFAULT_BUDGETS: AgentRunBudgets = { limits: {}, consumed: {} };

function mergeAgentRunBudgets(current: AgentRunBudgets, next: AgentRunBudgets): AgentRunBudgets {
    const limits = { ...current.limits };
    for (const [category, limit] of Object.entries(next.limits)) {
        limits[category] = limits[category] === undefined ? limit : Math.min(limits[category], limit);
    }
    const consumed = { ...current.consumed };
    for (const [category, amount] of Object.entries(next.consumed)) {
        consumed[category] = Math.max(consumed[category] ?? 0, amount);
    }
    return { limits, consumed };
}

const TERMINAL_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

const ALLOWED_PHASE_TRANSITIONS: Record<AgentRunPhase, ReadonlySet<AgentRunPhase>> = {
    created: new Set(['planning', 'failed', 'cancelled']),
    planning: new Set(['waiting-for-approval', 'previewing', 'executing', 'completed', 'failed', 'cancelled']),
    'waiting-for-approval': new Set(['executing', 'paused', 'failed', 'cancelled']),
    previewing: new Set(['completed', 'paused', 'failed', 'cancelled']),
    executing: new Set(['completed', 'paused', 'failed', 'cancelled', 'partially-completed']),
    paused: new Set(['planning', 'waiting-for-approval', 'previewing', 'executing', 'failed', 'cancelled']),
    completed: new Set(),
    failed: new Set(['paused']),
    cancelled: new Set(),
    'partially-completed': new Set(),
};

type CreateAgentRunInput = {
    runId: string;
    request: string;
    mode: AgentExecutionMode;
    createdRevision: string | null;
    requestedRoute?: AiBackendPreference;
    selectedRouteId?: string;
    createdAt?: number;
    scope?: AgentRunScope;
    grants?: AgentRunGrants;
    budgets?: AgentRunBudgets;
};

function assertNonEmpty(value: string, field: string): void {
    if (value.trim().length === 0) {
        throw new Error(`${field} must not be empty`);
    }
}

function updateAgentRun(runId: string, updatedAt: number, update: (run: AgentRun) => AgentRun): AgentRun {
    const state = readAgentRunState();
    const index = state.runs.findIndex((run) => run.runId === runId);
    if (index < 0) {
        throw new Error(`Unknown agent run: ${runId}`);
    }
    const current = state.runs[index]!;
    const next = { ...update(structuredClone(current)), updatedAt };
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState({ ...state, runs });
    return structuredClone(next);
}

function clearAgentRuns(): void {
    resetAgentRunState();
}

function getAgentRun(runId: string): AgentRun | null {
    const run = readAgentRunState().runs.find((candidate) => candidate.runId === runId);
    return run ? structuredClone(run) : null;
}

function createAgentRun(input: CreateAgentRunInput): AgentRun {
    assertNonEmpty(input.runId, 'runId');
    assertNonEmpty(input.request, 'request');
    const state = readAgentRunState();
    if (state.runs.some((run) => run.runId === input.runId)) {
        throw new Error(`Agent run already exists: ${input.runId}`);
    }
    const createdAt = input.createdAt ?? Date.now();
    const run: AgentRun = {
        schemaVersion: AGENT_RUN_SCHEMA_VERSION,
        runId: input.runId,
        request: input.request,
        mode: input.mode,
        phase: 'created',
        revisions: {
            created: input.createdRevision,
            planned: null,
            approved: null,
            committed: null,
        },
        scope: structuredClone(input.scope ?? DEFAULT_SCOPE),
        grants: structuredClone(input.grants ?? DEFAULT_GRANTS),
        budgets: structuredClone(input.budgets ?? DEFAULT_BUDGETS),
        budgetAttempts: [],
        plan: null,
        batches: [],
        receipts: [],
        renders: [],
        analyses: [],
        modelRoute: {
            requestedRoute: input.requestedRoute ?? 'legacy-unknown',
            selectedRouteId: input.selectedRouteId ?? null,
        },
        providerUsage: [],
        errors: [],
        cancellation: {
            generation: 0,
            requestedAt: null,
            reason: null,
            consumerAcknowledgedAt: null,
            transportAcknowledgedAt: null,
            backendAcknowledgedAt: null,
        },
        committedWork: [],
        retriableWork: [],
        temporaryAssets: [],
        manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
        workLeases: [],
        createdAt,
        updatedAt: createdAt,
    };
    persistAgentRunState({ ...state, runs: [...state.runs, run] });
    return structuredClone(run);
}

function transitionAgentRunPhase(input: {
    runId: string;
    phase: AgentRunPhase;
    revision?: string;
    transitionedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.transitionedAt ?? Date.now(), (run) => {
        if (run.phase === input.phase) {
            return run;
        }
        if (!ALLOWED_PHASE_TRANSITIONS[run.phase].has(input.phase)) {
            throw new Error(`Agent run cannot transition from ${run.phase} to ${input.phase}`);
        }
        const revisions = { ...run.revisions };
        if (input.revision !== undefined) {
            if (input.phase === 'planning') {
                revisions.planned = input.revision;
            } else if (input.phase === 'executing') {
                revisions.approved = input.revision;
            } else if (input.phase === 'completed' || input.phase === 'partially-completed') {
                revisions.committed = input.revision;
            }
        }
        return { ...run, phase: input.phase, revisions };
    });
}

function recordAgentRunPlan(input: {
    runId: string;
    summary: string;
    commandIds: string[];
    serializedBatchIdentity: string | null;
    applicationToolReceipts?: ApplicationToolReceipt[];
    revision: string;
    scope: AgentRunScope;
    grants: AgentRunGrants;
    budgets: AgentRunBudgets;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        phase: 'planning',
        revisions: { ...run.revisions, planned: input.revision },
        scope: structuredClone(input.scope),
        grants: structuredClone(input.grants),
        budgets: mergeAgentRunBudgets(run.budgets, input.budgets),
        plan: {
            summary: input.summary,
            commandIds: [...input.commandIds],
            serializedBatchIdentity: input.serializedBatchIdentity,
            applicationToolReceipts: structuredClone(input.applicationToolReceipts ?? []),
        },
    }));
}

function recordAgentRunApplicationToolEvidence(input: {
    runId: string;
    summary: string;
    applicationToolReceipts: ApplicationToolReceipt[];
    revision: string;
    scope: AgentRunScope;
    grants: AgentRunGrants;
    budgets: AgentRunBudgets;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => {
        const plan =
            run.plan === null
                ? {
                      summary: input.summary,
                      commandIds: [],
                      serializedBatchIdentity: null,
                      applicationToolReceipts: structuredClone(input.applicationToolReceipts),
                  }
                : {
                      ...run.plan,
                      applicationToolReceipts: structuredClone(input.applicationToolReceipts),
                  };
        if (run.plan !== null) {
            return { ...run, plan };
        }
        return {
            ...run,
            revisions: { ...run.revisions, planned: run.revisions.planned ?? input.revision },
            scope: structuredClone(input.scope),
            grants: structuredClone(input.grants),
            budgets: mergeAgentRunBudgets(run.budgets, input.budgets),
            plan,
        };
    });
}

function recordAgentRunBatch(input: { runId: string; batch: AgentRunBatch; recordedAt?: number }): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        batches: [
            ...run.batches.filter((batch) => batch.batchId !== input.batch.batchId),
            structuredClone(input.batch),
        ],
    }));
}

function updateAgentRunBatchStatus(input: {
    runId: string;
    batchId: string;
    status: AgentRunBatch['status'];
    receiptIdentity?: string;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        batches: run.batches.map((batch) =>
            batch.batchId === input.batchId
                ? {
                      ...batch,
                      status: input.status,
                      receiptIdentity: input.receiptIdentity ?? batch.receiptIdentity,
                  }
                : batch
        ),
    }));
}

function recordAgentRunProviderUsage(input: {
    runId: string;
    usage: AgentRunProviderUsage;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => {
        const usage = structuredClone(input.usage);
        const existingIndex =
            usage.correlationId === undefined
                ? -1
                : run.providerUsage.findIndex((candidate) => candidate.correlationId === usage.correlationId);
        if (existingIndex >= 0) {
            const existing = run.providerUsage[existingIndex]!;
            const providerUsage = [...run.providerUsage];
            providerUsage[existingIndex] = {
                ...existing,
                ...usage,
                attempt: existing.attempt,
                disclosure: existing.disclosure ?? usage.disclosure,
            };
            return { ...run, providerUsage };
        }
        usage.attempt ??= run.providerUsage.length + 1;
        return {
            ...run,
            modelRoute:
                usage.routeId !== undefined ? { ...run.modelRoute, selectedRouteId: usage.routeId } : run.modelRoute,
            providerUsage: [...run.providerUsage, usage],
        };
    });
}

function reserveAgentRunBudget(input: {
    runId: string;
    attemptId: string;
    category: string;
    estimate: number;
    provenance: AgentRunBudgetAttempt['provenance'];
    estimateMethod?: AgentRunBudgetAttempt['estimateMethod'];
    reservedAt?: number;
}): { status: 'reserved' | 'hard-limit-reached'; reason?: string } {
    if (!Number.isFinite(input.estimate) || input.estimate < 0) {
        throw new Error('Budget estimate must be a non-negative finite number');
    }
    const run = getAgentRun(input.runId);
    if (run === null) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const existing = run.budgetAttempts.find((attempt) => attempt.attemptId === input.attemptId);
    if (existing !== undefined) {
        return { status: 'reserved' };
    }
    const limit = run.budgets.limits[input.category];
    const consumed = run.budgets.consumed[input.category] ?? 0;
    if (limit !== undefined && consumed + input.estimate > limit) {
        return { status: 'hard-limit-reached', reason: input.category };
    }
    updateAgentRun(input.runId, input.reservedAt ?? Date.now(), (current) => ({
        ...current,
        budgets: {
            ...current.budgets,
            consumed: { ...current.budgets.consumed, [input.category]: consumed + input.estimate },
        },
        budgetAttempts: [
            ...current.budgetAttempts,
            {
                attemptId: input.attemptId,
                category: input.category,
                reserved: input.estimate,
                actual: 0,
                provenance: input.provenance,
                ...(input.estimateMethod === undefined ? {} : { estimateMethod: input.estimateMethod }),
                final: false,
            },
        ],
    }));
    return { status: 'reserved' };
}

function reconcileAgentRunBudgetAttempt(input: {
    runId: string;
    attemptId: string;
    consumed: number;
    mode: 'delta' | 'cumulative' | 'final';
    provenance: AgentRunBudgetAttempt['provenance'];
    reconciledAt?: number;
}): AgentRun {
    if (!Number.isFinite(input.consumed) || input.consumed < 0) {
        throw new Error('Budget usage must be a non-negative finite number');
    }
    return updateAgentRun(input.runId, input.reconciledAt ?? Date.now(), (run) => {
        const index = run.budgetAttempts.findIndex((attempt) => attempt.attemptId === input.attemptId);
        if (index < 0) {
            throw new Error(`Unknown budget attempt: ${input.attemptId}`);
        }
        const previous = run.budgetAttempts[index]!;
        const actual =
            input.mode === 'delta' ? previous.actual + input.consumed : Math.max(previous.actual, input.consumed);
        const additionalCeiling = Math.max(0, actual - previous.reserved);
        const attempts = [...run.budgetAttempts];
        attempts[index] = {
            ...previous,
            reserved: Math.max(previous.reserved, actual),
            actual,
            provenance: input.provenance,
            final: previous.final || input.mode === 'final',
        };
        return {
            ...run,
            budgetAttempts: attempts,
            budgets:
                additionalCeiling === 0
                    ? run.budgets
                    : {
                          ...run.budgets,
                          consumed: {
                              ...run.budgets.consumed,
                              [previous.category]: (run.budgets.consumed[previous.category] ?? 0) + additionalCeiling,
                          },
                      },
        };
    });
}

function recordAgentRunArtifact(input: {
    runId: string;
    kind: 'render' | 'analysis';
    artifact: AgentRunArtifact;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        [input.kind === 'render' ? 'renders' : 'analyses']: [
            ...(input.kind === 'render' ? run.renders : run.analyses),
            structuredClone(input.artifact),
        ],
    }));
}

function recordAgentRunError(input: {
    runId: string;
    error: AgentRunError;
    terminal?: boolean;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? input.error.occurredAt, (run) => {
        let phase = run.phase;
        if (input.terminal) {
            phase = run.committedWork.length > 0 ? 'partially-completed' : 'failed';
        }
        return {
            ...run,
            phase,
            batches: input.error.workId
                ? run.batches.map((batch) =>
                      batch.batchId === input.error.workId ? { ...batch, status: 'failed' } : batch
                  )
                : run.batches,
            errors: [...run.errors, structuredClone(input.error)],
            retriableWork:
                !input.error.retriable && input.error.workId
                    ? run.retriableWork.filter((work) => work.workId !== input.error.workId)
                    : run.retriableWork,
        };
    });
}

function recordAgentRunCommittedWork(input: {
    runId: string;
    workId: string;
    receiptIdentity: string;
    revertGroupId?: string;
    committedRevision?: string;
    renderJobIds?: string[];
    analysisIds?: string[];
    completesRun?: boolean;
    committedAt?: number;
}): AgentRun {
    const committedAt = input.committedAt ?? Date.now();
    return updateAgentRun(input.runId, committedAt, (run) => {
        const committedWork = {
            workId: input.workId,
            receiptIdentity: input.receiptIdentity,
            revertGroupId: input.revertGroupId ?? null,
            committedAt,
        };
        const receipts = [...run.receipts.filter((receipt) => receipt.workId !== input.workId), committedWork];
        const renderJobIds = input.renderJobIds ?? [];
        const analysisIds = input.analysisIds ?? [];
        const phase = (() => {
            if (input.completesRun !== false) {
                return 'completed' as const;
            }
            if (run.phase === 'cancelled' || run.phase === 'failed') {
                return 'partially-completed' as const;
            }
            return run.phase;
        })();
        return {
            ...run,
            phase,
            revisions: {
                ...run.revisions,
                committed: input.committedRevision ?? run.revisions.committed,
            },
            receipts,
            renders: [
                ...run.renders.filter((artifact) => !renderJobIds.includes(artifact.artifactId)),
                ...renderJobIds.map((artifactId) => ({
                    artifactId,
                    workId: input.workId,
                    status: 'completed' as const,
                    summary: null,
                })),
            ],
            analyses: [
                ...run.analyses.filter((artifact) => !analysisIds.includes(artifact.artifactId)),
                ...analysisIds.map((artifactId) => ({
                    artifactId,
                    workId: input.workId,
                    status: 'completed' as const,
                    summary: null,
                })),
            ],
            batches: run.batches.map((batch) =>
                batch.batchId === input.workId
                    ? { ...batch, status: 'committed', receiptIdentity: input.receiptIdentity }
                    : batch
            ),
            committedWork: [...run.committedWork.filter((work) => work.workId !== input.workId), committedWork],
        };
    });
}

function registerAgentRunTemporaryAsset(input: {
    runId: string;
    assetId: string;
    kind: 'render' | 'analysis' | 'import' | 'other';
    cleanupOwner: string;
    createdAt?: number;
}): AgentRun {
    const createdAt = input.createdAt ?? Date.now();
    return updateAgentRun(input.runId, createdAt, (run) => ({
        ...run,
        temporaryAssets: [
            ...run.temporaryAssets.filter((asset) => asset.assetId !== input.assetId),
            {
                assetId: input.assetId,
                kind: input.kind,
                cleanupOwner: input.cleanupOwner,
                status: 'live',
                createdAt,
            },
        ],
    }));
}

function releaseAgentRunTemporaryAsset(input: {
    runId: string;
    assetId: string;
    cleanupOwner: string;
    releasedAt?: number;
}): AgentRun {
    const releasedAt = input.releasedAt ?? Date.now();
    return updateAgentRun(input.runId, releasedAt, (run) => {
        const asset = run.temporaryAssets.find((candidate) => candidate.assetId === input.assetId);
        if (!asset) {
            throw new Error(`Unknown temporary asset: ${input.assetId}`);
        }
        if (asset.cleanupOwner !== input.cleanupOwner) {
            throw new Error(`Temporary asset cleanup owner changed: ${input.assetId}`);
        }
        if (asset.status === 'released') {
            return run;
        }
        if (asset.status !== 'cleanup-pending') {
            throw new Error(`Temporary asset is not pending cleanup: ${input.assetId}`);
        }
        return {
            ...run,
            temporaryAssets: run.temporaryAssets.map((candidate) =>
                candidate.assetId === input.assetId ? { ...candidate, status: 'released' } : candidate
            ),
        };
    });
}

function prepareAgentRunTemporaryAssetCleanup(input: {
    runId: string;
    assetId: string;
    cleanupOwner: string;
    preparedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.preparedAt ?? Date.now(), (run) => {
        const asset = run.temporaryAssets.find((candidate) => candidate.assetId === input.assetId);
        if (!asset) {
            throw new Error(`Unknown temporary asset: ${input.assetId}`);
        }
        if (asset.cleanupOwner !== input.cleanupOwner) {
            throw new Error(`Temporary asset cleanup owner changed: ${input.assetId}`);
        }
        if (asset.status === 'released') {
            return run;
        }
        return {
            ...run,
            temporaryAssets: run.temporaryAssets.map((candidate) =>
                candidate.assetId === input.assetId ? { ...candidate, status: 'cleanup-pending' } : candidate
            ),
        };
    });
}

function forgetAgentRunTemporaryAsset(input: { runId: string; assetId: string; cleanupOwner: string }): AgentRun {
    return updateAgentRun(input.runId, Date.now(), (run) => {
        const asset = run.temporaryAssets.find((candidate) => candidate.assetId === input.assetId);
        if (!asset || asset.cleanupOwner !== input.cleanupOwner) {
            throw new Error(`Temporary asset cannot be forgotten: ${input.assetId}`);
        }
        return {
            ...run,
            temporaryAssets: run.temporaryAssets.filter((candidate) => candidate.assetId !== input.assetId),
        };
    });
}

function requireAgentRunManualResume(input: {
    runId: string;
    reason: string;
    workIds: string[];
    requiredAt?: number;
}): AgentRun {
    const requiredAt = input.requiredAt ?? Date.now();
    return updateAgentRun(input.runId, requiredAt, (run) => {
        if (TERMINAL_PHASES.has(run.phase)) {
            throw new Error(`Terminal agent run cannot require resume: ${run.runId}`);
        }
        return {
            ...run,
            phase: 'paused',
            manualResume: {
                required: true,
                reason: input.reason,
                workIds: [...new Set(input.workIds)],
                requiredAt,
            },
        };
    });
}

function cancelAgentRun(input: { runId: string; reason: string; requestedAt?: number }): AgentRun {
    const requestedAt = input.requestedAt ?? Date.now();
    return updateAgentRun(input.runId, requestedAt, (run) => {
        if (TERMINAL_PHASES.has(run.phase)) {
            return run;
        }
        return {
            ...run,
            phase: run.committedWork.length > 0 ? 'partially-completed' : 'cancelled',
            cancellation: {
                ...run.cancellation,
                generation: run.cancellation.generation + 1,
                requestedAt,
                reason: input.reason,
                consumerAcknowledgedAt: requestedAt,
            },
            batches: run.batches.map((batch) =>
                batch.status === 'committed' || batch.status === 'no-op' ? batch : { ...batch, status: 'cancelled' }
            ),
            workLeases: run.workLeases.map((lease) =>
                lease.terminalState === null ? { ...lease, terminalState: 'cancelled', settledAt: requestedAt } : lease
            ),
            temporaryAssets: run.temporaryAssets.map((asset) =>
                asset.status === 'live' ? { ...asset, status: 'cleanup-pending' } : asset
            ),
        };
    });
}

function acknowledgeAgentRunCancellation(input: {
    runId: string;
    level: 'consumer' | 'transport' | 'backend';
    acknowledgedAt?: number;
}): AgentRun {
    const acknowledgedAt = input.acknowledgedAt ?? Date.now();
    return updateAgentRun(input.runId, acknowledgedAt, (run) => {
        if (run.cancellation.requestedAt === null) {
            throw new Error(`Agent run cancellation was not requested: ${run.runId}`);
        }
        const cancellation = { ...run.cancellation };
        if (input.level === 'consumer') {
            cancellation.consumerAcknowledgedAt = acknowledgedAt;
        } else if (input.level === 'transport') {
            cancellation.transportAcknowledgedAt = acknowledgedAt;
        } else {
            cancellation.backendAcknowledgedAt = acknowledgedAt;
        }
        return { ...run, cancellation };
    });
}

export const agentRunLifecycle = {
    acknowledgeCancellation: acknowledgeAgentRunCancellation,
    cancel: cancelAgentRun,
    clear: clearAgentRuns,
    create: createAgentRun,
    get: getAgentRun,
    forgetTemporaryAsset: forgetAgentRunTemporaryAsset,
    recordArtifact: recordAgentRunArtifact,
    recordBatch: recordAgentRunBatch,
    recordCommittedWork: recordAgentRunCommittedWork,
    recordError: recordAgentRunError,
    recordApplicationToolEvidence: recordAgentRunApplicationToolEvidence,
    recordPlan: recordAgentRunPlan,
    recordProviderUsage: recordAgentRunProviderUsage,
    reconcileBudgetAttempt: reconcileAgentRunBudgetAttempt,
    reserveBudget: reserveAgentRunBudget,
    releaseTemporaryAsset: releaseAgentRunTemporaryAsset,
    prepareTemporaryAssetCleanup: prepareAgentRunTemporaryAssetCleanup,
    registerTemporaryAsset: registerAgentRunTemporaryAsset,
    requireManualResume: requireAgentRunManualResume,
    transitionPhase: transitionAgentRunPhase,
    updateBatchStatus: updateAgentRunBatchStatus,
} as const;
