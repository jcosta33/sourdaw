import { type AgentContextEvidence } from '../models/AgentContext';
import { type AgentExecutionMode } from '../models/AgentExecutionMode';
import {
    AGENT_RUN_SCHEMA_VERSION,
    type AgentRun,
    type AgentRunArtifact,
    type AgentRunBatch,
    type AgentRunBudgetAttempt,
    type AgentRunBudgets,
    type AgentRunDecision,
    type AgentRunDecisionResume,
    type AgentRunError,
    type AgentRunGrants,
    type AgentRunPlan,
    type AgentRunPhase,
    type AgentRunPreparedStemImportRecovery,
    type AgentRunProviderUsage,
    type AgentRunSagaStep,
    type AgentRunScope,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type AiBackendPreference } from '../models/LlmOrchestrationTypes';
import { persistAgentRunState, readAgentRunState, resetAgentRunState } from '../stores/agentRunStore';

import { normalizeAgentFailure } from './agentErrorAndSaga';

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
    resume?: AgentRunDecisionResume;
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

function createLegacyAgentRunPlan(input: {
    summary: string;
    commandIds: string[];
    serializedBatchIdentity: string | null;
    applicationToolReceipts: ApplicationToolReceipt[];
    revision: string;
    scope: AgentRunScope;
}): AgentRunPlan {
    return {
        summary: input.summary,
        commandIds: [...input.commandIds],
        serializedBatchIdentity: input.serializedBatchIdentity,
        applicationToolReceipts: structuredClone(input.applicationToolReceipts),
        revision: input.revision,
        classification: 'simple',
        showPlanPanel: false,
        objective: input.summary,
        interpretedConstraints: [`Plan is bound to project revision ${input.revision}.`],
        scope: structuredClone(input.scope),
        steps: [],
        expectedImpact: {
            project: [],
            audible: {
                status: 'not-claimed',
                reason: 'No audible result is claimed by a persisted legacy plan.',
            },
        },
        capabilities: [],
        risks: [],
        approvalPoints: [],
        validationStrategy: ['Revalidate the persisted project revision before resuming.'],
        stoppingConditions: ['Stop if the persisted project revision is no longer current.'],
        alternatives: [],
        needsUserDecision: false,
    };
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
        decision: null,
        resume: input.resume ? structuredClone(input.resume) : null,
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
        saga: { schemaVersion: 1, steps: [] },
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
        preparedStemImports: [],
        manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
        workLeases: [],
        contextEvidence: null,
        createdAt,
        updatedAt: createdAt,
    };
    persistAgentRunState({ ...state, runs: [...state.runs, run] });
    return structuredClone(run);
}

function recordAgentRunContextEvidence(input: {
    runId: string;
    evidence: AgentContextEvidence;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        contextEvidence: structuredClone(input.evidence),
    }));
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
    plan?: AgentRunPlan;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => {
        if (TERMINAL_PHASES.has(run.phase)) {
            throw new Error(`Terminal agent run cannot record a plan: ${run.runId}`);
        }
        return {
            ...run,
            phase: 'planning',
            revisions: { ...run.revisions, planned: input.revision },
            scope: structuredClone(input.scope),
            grants: structuredClone(input.grants),
            budgets: mergeAgentRunBudgets(run.budgets, input.budgets),
            plan: structuredClone(
                input.plan ??
                    createLegacyAgentRunPlan({
                        summary: input.summary,
                        commandIds: input.commandIds,
                        serializedBatchIdentity: input.serializedBatchIdentity,
                        applicationToolReceipts: input.applicationToolReceipts ?? [],
                        revision: input.revision,
                        scope: input.scope,
                    })
            ),
        };
    });
}

function recordAgentRunDecision(input: { runId: string; decision: AgentRunDecision; recordedAt?: number }): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => ({
        ...run,
        decision: structuredClone(input.decision),
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
                ? createLegacyAgentRunPlan({
                      summary: input.summary,
                      commandIds: [],
                      serializedBatchIdentity: null,
                      applicationToolReceipts: input.applicationToolReceipts,
                      revision: input.revision,
                      scope: input.scope,
                  })
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

type AgentRunBudgetReservation = {
    attemptId: string;
    category: string;
    estimate: number;
    provenance: AgentRunBudgetAttempt['provenance'];
    estimateMethod?: AgentRunBudgetAttempt['estimateMethod'];
};

type AgentRunBudgetReservationInput = AgentRunBudgetReservation & {
    runId: string;
};

type AgentRunBudgetReservationResult = { status: 'reserved' | 'hard-limit-reached'; reason?: string };

function reserveAgentRunBudgetBatch(input: {
    runId: string;
    attempts: readonly AgentRunBudgetReservation[];
    reservedAt?: number;
}): AgentRunBudgetReservationResult {
    const run = getAgentRun(input.runId);
    if (run === null) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const attemptIds = new Set<string>();
    const newAttempts: AgentRunBudgetReservation[] = [];
    const additionalByCategory = new Map<string, number>();
    for (const attempt of input.attempts) {
        if (!Number.isFinite(attempt.estimate) || attempt.estimate < 0) {
            throw new Error('Budget estimate must be a non-negative finite number');
        }
        if (attemptIds.has(attempt.attemptId)) {
            throw new Error(`Duplicate budget attempt: ${attempt.attemptId}`);
        }
        attemptIds.add(attempt.attemptId);
        if (run.budgetAttempts.some((existing) => existing.attemptId === attempt.attemptId)) {
            continue;
        }
        newAttempts.push(attempt);
        additionalByCategory.set(
            attempt.category,
            (additionalByCategory.get(attempt.category) ?? 0) + attempt.estimate
        );
    }
    for (const [category, additional] of additionalByCategory) {
        const limit = run.budgets.limits[category];
        const consumed = run.budgets.consumed[category] ?? 0;
        if (limit !== undefined && consumed + additional > limit) {
            return { status: 'hard-limit-reached', reason: category };
        }
    }
    if (newAttempts.length === 0) {
        return { status: 'reserved' };
    }
    updateAgentRun(input.runId, input.reservedAt ?? Date.now(), (current) => {
        const consumed = { ...current.budgets.consumed };
        for (const [category, additional] of additionalByCategory) {
            consumed[category] = (consumed[category] ?? 0) + additional;
        }
        return {
            ...current,
            budgets: { ...current.budgets, consumed },
            budgetAttempts: [
                ...current.budgetAttempts,
                ...newAttempts.map((attempt) => ({
                    attemptId: attempt.attemptId,
                    category: attempt.category,
                    reserved: attempt.estimate,
                    actual: 0,
                    provenance: attempt.provenance,
                    ...(attempt.estimateMethod === undefined ? {} : { estimateMethod: attempt.estimateMethod }),
                    final: false,
                })),
            ],
        };
    });
    return { status: 'reserved' };
}

function reserveAgentRunBudget(
    input: AgentRunBudgetReservationInput & { reservedAt?: number }
): AgentRunBudgetReservationResult {
    return reserveAgentRunBudgetBatch({ ...input, attempts: [input] });
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

/** Records only application-owned saga facts; external owners still perform effects and compensation. */
function recordAgentRunSagaStep(input: { runId: string; step: AgentRunSagaStep; recordedAt?: number }): AgentRun {
    const recordedAt = input.recordedAt ?? input.step.updatedAt;
    return updateAgentRun(input.runId, recordedAt, (run) => {
        const existing = run.saga.steps.find((step) => step.stepId === input.step.stepId);
        if (existing && existing.order !== input.step.order) {
            throw new Error(`Agent saga step order changed: ${input.step.stepId}`);
        }
        if (input.step.order < 0 || !Number.isInteger(input.step.order)) {
            throw new Error('Agent saga step order must be a non-negative integer');
        }
        const steps = [
            ...run.saga.steps.filter((step) => step.stepId !== input.step.stepId),
            structuredClone(input.step),
        ].sort((left, right) => left.order - right.order);
        const hasUnsettledExternalSagaStep = steps.some(
            (step) => step.state === 'pending' || step.state === 'external-pending' || step.state === 'uncompensated'
        );
        return {
            ...run,
            phase: hasUnsettledExternalSagaStep && run.committedWork.length > 0 ? 'partially-completed' : run.phase,
            saga: { schemaVersion: 1, steps },
        };
    });
}

function recordAgentRunSagaCompensation(input: {
    runId: string;
    stepId: string;
    state: Extract<AgentRunSagaStep['state'], 'compensated' | 'uncompensated' | 'manual-repair'>;
    error?: string;
    recordedAt?: number;
}): AgentRun {
    const recordedAt = input.recordedAt ?? Date.now();
    return updateAgentRun(input.runId, recordedAt, (run) => {
        const step = run.saga.steps.find((candidate) => candidate.stepId === input.stepId);
        if (!step) {
            throw new Error(`Unknown agent saga step: ${input.stepId}`);
        }
        return {
            ...run,
            saga: {
                schemaVersion: 1,
                steps: run.saga.steps.map((candidate) =>
                    candidate.stepId !== input.stepId
                        ? candidate
                        : {
                              ...candidate,
                              state: input.state,
                              compensation: {
                                  ...candidate.compensation,
                                  attempts: candidate.compensation.attempts + 1,
                                  lastError: input.error ?? null,
                              },
                              updatedAt: recordedAt,
                          }
                ),
            },
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
        const hasUnsettledExternalSagaStep = run.saga.steps.some(
            (step) => step.state === 'pending' || step.state === 'external-pending' || step.state === 'uncompensated'
        );
        const phase = (() => {
            if (hasUnsettledExternalSagaStep) {
                return 'partially-completed' as const;
            }
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

function recordAgentRunPreparedStemImportRecovery(input: {
    runId: string;
    recovery: AgentRunPreparedStemImportRecovery;
    recordedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.recordedAt ?? Date.now(), (run) => {
        const resourceIds = new Set(input.recovery.resources.map((resource) => resource.audioBufferId));
        const otherRecoveryResourceIds = new Set(
            run.preparedStemImports
                .filter((recovery) => recovery.batchId !== input.recovery.batchId)
                .flatMap((recovery) => recovery.resources.map((resource) => resource.audioBufferId))
        );
        if (
            resourceIds.size !== input.recovery.resources.length ||
            input.recovery.resources.some((resource) => otherRecoveryResourceIds.has(resource.audioBufferId)) ||
            input.recovery.resources.some(
                (resource) =>
                    !run.temporaryAssets.some(
                        (asset) =>
                            asset.assetId === resource.audioBufferId &&
                            asset.kind === 'import' &&
                            asset.cleanupOwner === 'stem-import-preparation' &&
                            asset.status !== 'released'
                    )
            )
        ) {
            throw new Error(`Prepared stem recovery does not match live run assets: ${input.recovery.batchId}`);
        }
        return {
            ...run,
            preparedStemImports: [
                ...run.preparedStemImports.filter((recovery) => recovery.batchId !== input.recovery.batchId),
                structuredClone(input.recovery),
            ],
        };
    });
}

function forgetAgentRunPreparedStemImportRecovery(input: { runId: string; batchId: string }): AgentRun {
    return updateAgentRun(input.runId, Date.now(), (run) => ({
        ...run,
        preparedStemImports: run.preparedStemImports.filter((recovery) => recovery.batchId !== input.batchId),
    }));
}

function requireAgentRunPreparedStemManualRepair(input: {
    runId: string;
    assetIds: string[];
    batchIds: string[];
    requiredAt?: number;
}): AgentRun {
    const requiredAt = input.requiredAt ?? Date.now();
    return updateAgentRun(input.runId, requiredAt, (run) => {
        if (run.errors.some((error) => error.code === 'prepared-stem-recovery-metadata-missing')) {
            return run;
        }
        return {
            ...run,
            errors: [
                ...run.errors,
                {
                    ...normalizeAgentFailure({
                        category: 'asset',
                        source: 'restart-recovery',
                        occurredAt: requiredAt,
                        related: { workIds: input.batchIds, artifactIds: input.assetIds },
                        retry: 'never',
                        compensation: 'manual-repair',
                        knownDomain: true,
                    }),
                    code: 'prepared-stem-recovery-metadata-missing',
                },
            ],
            manualResume: {
                required: true,
                reason: 'Prepared stem cleanup identity is unavailable. Keep the staged media retained and inspect it manually.',
                workIds: [...new Set([...run.manualResume.workIds, ...input.batchIds])],
                requiredAt,
            },
        };
    });
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

function claimAgentRunDecisionResume(input: { runId: string; attemptId: string; claimedAt?: number }): AgentRun {
    assertNonEmpty(input.attemptId, 'attemptId');
    return updateAgentRun(input.runId, input.claimedAt ?? Date.now(), (run) => {
        if (run.phase !== 'paused' || run.cancellation.requestedAt !== null || run.decision === null) {
            throw new Error('Agent run has no resumable decision.');
        }
        if (run.decision.selectedAlternativeId !== null || run.decision.resumeAttemptId !== null) {
            throw new Error('Agent run decision was already consumed or claimed.');
        }
        return { ...run, decision: { ...run.decision, resumeAttemptId: input.attemptId } };
    });
}

function releaseAgentRunDecisionResumeClaim(input: {
    runId: string;
    attemptId: string;
    releasedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.releasedAt ?? Date.now(), (run) => {
        if (run.decision?.resumeAttemptId !== input.attemptId || run.decision.selectedAlternativeId !== null) {
            return run;
        }
        return { ...run, decision: { ...run.decision, resumeAttemptId: null } };
    });
}

function selectAgentRunDecisionAlternative(input: {
    runId: string;
    alternativeId: string;
    attemptId?: string;
    selectedAt?: number;
}): AgentRun {
    return updateAgentRun(input.runId, input.selectedAt ?? Date.now(), (run) => {
        if (run.phase !== 'paused' || run.cancellation.requestedAt !== null || run.decision === null) {
            throw new Error('Agent run has no resumable decision.');
        }
        if (run.decision.selectedAlternativeId !== null) {
            throw new Error('Agent run decision was already consumed.');
        }
        if (
            input.attemptId === undefined
                ? run.decision.resumeAttemptId !== null
                : run.decision.resumeAttemptId !== input.attemptId
        ) {
            throw new Error('Agent run decision is not claimed by this replacement attempt.');
        }
        if (!run.decision.alternatives.some((alternative) => alternative.id === input.alternativeId)) {
            throw new Error('Agent run decision alternative is unavailable.');
        }
        return {
            ...run,
            decision: { ...run.decision, selectedAlternativeId: input.alternativeId, resumeAttemptId: null },
            manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
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
    claimDecisionResume: claimAgentRunDecisionResume,
    create: createAgentRun,
    get: getAgentRun,
    forgetTemporaryAsset: forgetAgentRunTemporaryAsset,
    forgetPreparedStemImportRecovery: forgetAgentRunPreparedStemImportRecovery,
    recordArtifact: recordAgentRunArtifact,
    recordBatch: recordAgentRunBatch,
    recordCommittedWork: recordAgentRunCommittedWork,
    recordContextEvidence: recordAgentRunContextEvidence,
    recordError: recordAgentRunError,
    recordSagaStep: recordAgentRunSagaStep,
    recordSagaCompensation: recordAgentRunSagaCompensation,
    recordApplicationToolEvidence: recordAgentRunApplicationToolEvidence,
    recordPlan: recordAgentRunPlan,
    recordDecision: recordAgentRunDecision,
    recordProviderUsage: recordAgentRunProviderUsage,
    recordPreparedStemImportRecovery: recordAgentRunPreparedStemImportRecovery,
    reconcileBudgetAttempt: reconcileAgentRunBudgetAttempt,
    reserveBudget: reserveAgentRunBudget,
    reserveBudgetBatch: reserveAgentRunBudgetBatch,
    selectDecisionAlternative: selectAgentRunDecisionAlternative,
    releaseDecisionResumeClaim: releaseAgentRunDecisionResumeClaim,
    releaseTemporaryAsset: releaseAgentRunTemporaryAsset,
    prepareTemporaryAssetCleanup: prepareAgentRunTemporaryAssetCleanup,
    registerTemporaryAsset: registerAgentRunTemporaryAsset,
    requireManualResume: requireAgentRunManualResume,
    requirePreparedStemManualRepair: requireAgentRunPreparedStemManualRepair,
    transitionPhase: transitionAgentRunPhase,
    updateBatchStatus: updateAgentRunBatchStatus,
} as const;
