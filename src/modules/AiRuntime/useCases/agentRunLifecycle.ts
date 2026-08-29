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
    type AgentRunPendingEffect,
    type AgentRunPendingEffectContinuation,
    type AgentRunPendingEffectRecovery,
    type AgentRunPhase,
    type AgentRunPreparedStemImportRecovery,
    type AgentRunPreparedStemImportRecoveryCapsule,
    type AgentRunProviderUsage,
    type AgentRunSagaStep,
    type AgentRunScope,
    type AgentRunState,
    type AgentRunWorkOwnerKind,
    type AgentRunWorkTerminalState,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type AiBackendPreference } from '../models/LlmOrchestrationTypes';
import { persistAgentRunState, readAgentRunState, resetAgentRunState } from '../stores/agentRunStore';
import { hasSamePreparedStemImportRecovery } from '../validators/hasSamePreparedStemImportRecovery';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import {
    type ClaimAgentRunWorkLeaseResult as ClaimWorkLeaseResult,
    claimAgentRunWorkLease as claimWorkLease,
} from './agentRequestOrchestration/claimAgentRunWorkLease';
import { recoverInterruptedAgentRunState as recoverInterruptedRunState } from './agentRequestOrchestration/recoverInterruptedAgentRunState';
import { reduceAgentRunTransition } from './agentRequestOrchestration/reduceAgentRunTransition';
import {
    type RetryAgentRunWorkLeaseResult as RetryWorkLeaseResult,
    retryAgentRunWorkLease as retryWorkLease,
} from './agentRequestOrchestration/retryAgentRunWorkLease';
import {
    type SettleAgentRunWorkLeaseResult as SettleWorkLeaseResult,
    settleAgentRunWorkLease as settleWorkLease,
} from './agentRequestOrchestration/settleAgentRunWorkLease';
import { projectAgentRunReceiptSaga, type AgentRunReceiptSagaInput } from './projectAgentRunReceiptSaga';

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

function updateAgentRunIfPresent(
    runId: string,
    updatedAt: number,
    update: (run: AgentRun) => AgentRun
): AgentRun | null {
    const state = readAgentRunState();
    const index = state.runs.findIndex((run) => run.runId === runId);
    if (index < 0) {
        return null;
    }
    const current = state.runs[index]!;
    const next = { ...update(structuredClone(current)), updatedAt };
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState({ ...state, runs });
    return structuredClone(next);
}

function getPendingEffectRecoveryLedger(state: AgentRunState): AgentRunPendingEffectRecovery[] {
    return state.pendingEffectRecoveryLedger ?? [];
}

function withPendingEffectRecoveryLedger(
    state: AgentRunState,
    pendingEffectRecoveryLedger: AgentRunPendingEffectRecovery[]
): AgentRunState {
    if (pendingEffectRecoveryLedger.length === 0) {
        const { pendingEffectRecoveryLedger: _removed, ...withoutLedger } = state;
        return withoutLedger;
    }
    return { ...state, pendingEffectRecoveryLedger };
}

function getPreparedStemImportRecoveryLedger(state: AgentRunState): AgentRunPreparedStemImportRecoveryCapsule[] {
    return state.preparedStemImportRecoveryLedger ?? [];
}

function withPreparedStemImportRecoveryLedger(
    state: AgentRunState,
    preparedStemImportRecoveryLedger: AgentRunPreparedStemImportRecoveryCapsule[]
): AgentRunState {
    if (preparedStemImportRecoveryLedger.length === 0) {
        const { preparedStemImportRecoveryLedger: _removed, ...withoutLedger } = state;
        return withoutLedger;
    }
    return { ...state, preparedStemImportRecoveryLedger };
}

function isPreparedStemImportRecovery(
    recovery: Pick<AgentRunPreparedStemImportRecoveryCapsule, 'runId' | 'batchId'>,
    input: { runId: string; batchId: string }
): boolean {
    return recovery.runId === input.runId && recovery.batchId === input.batchId;
}

function isPendingEffectRecovery(
    recovery: AgentRunPendingEffectRecovery,
    input: { runId: string; batchId: string }
): boolean {
    return recovery.runId === input.runId && recovery.batchId === input.batchId;
}

function hasSamePendingEffectManualReviewBinding(
    continuation: AgentRunPendingEffectContinuation,
    recovery: AgentRunPendingEffectRecovery
): boolean {
    return (
        recovery.checkpoint === 'durable' &&
        recovery.batchId === continuation.batchId &&
        recovery.receiptIdentity === continuation.receiptIdentity &&
        recovery.serializedBatch === continuation.serializedBatch &&
        recovery.recovery === continuation.recovery &&
        recovery.lastError === continuation.lastError &&
        recovery.sourceRevision === continuation.sourceRevision &&
        JSON.stringify(recovery.authority) === JSON.stringify(continuation.authority) &&
        JSON.stringify(recovery.effects) === JSON.stringify(continuation.effects)
    );
}

function getExactPendingEffectManualReviewSagaStepIds(
    run: AgentRun,
    continuation: AgentRunPendingEffectContinuation
): Set<string> | null {
    const expectedStepIds = new Set(
        continuation.effects.map(({ commandId }) => `effect:${continuation.batchId}:${commandId}`)
    );
    if (continuation.effects.length === 0 || expectedStepIds.size !== continuation.effects.length) {
        return null;
    }
    const targetedSteps = run.saga.steps.filter(({ stepId }) => stepId.startsWith(`effect:${continuation.batchId}:`));
    if (targetedSteps.length !== expectedStepIds.size) {
        return null;
    }
    for (const stepId of expectedStepIds) {
        const matchingSteps = targetedSteps.filter((step) => step.stepId === stepId);
        if (
            matchingSteps.length !== 1 ||
            matchingSteps[0]?.owner !== 'external-effect' ||
            matchingSteps[0].workId !== continuation.batchId ||
            matchingSteps[0].receiptIdentity !== continuation.receiptIdentity ||
            matchingSteps[0].state !== 'manual-repair' ||
            matchingSteps[0].manualReviewDisposition !== undefined
        ) {
            return null;
        }
    }
    return expectedStepIds;
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
    } satisfies AgentRunPlan;
}

function clearAgentRuns(): void {
    resetAgentRunState();
}

function getAgentRun(runId: string): AgentRun | null {
    const run = readAgentRunState().runs.find((candidate) => candidate.runId === runId);
    return run ? structuredClone(run) : null;
}

function retryAgentRunPersistence(runId: string): AgentRun | null {
    const state = readAgentRunState();
    const run = state.runs.find((candidate) => candidate.runId === runId);
    if (!run) {
        return null;
    }
    persistAgentRunState(state);
    return structuredClone(run);
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
        pendingEffectContinuations: [],
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
        const phase = reduceAgentRunTransition(run.phase, { type: 'phase-requested', phase: input.phase });
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
        return { ...run, phase, revisions };
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
            phase: reduceAgentRunTransition(run.phase, { type: 'plan-recorded' }),
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
        const consumedDelta = input.mode === 'final' ? actual - previous.reserved : additionalCeiling;
        return {
            ...run,
            budgetAttempts: attempts,
            budgets:
                consumedDelta === 0
                    ? run.budgets
                    : {
                          ...run.budgets,
                          consumed: {
                              ...run.budgets.consumed,
                              [previous.category]: Math.max(
                                  0,
                                  (run.budgets.consumed[previous.category] ?? 0) + consumedDelta
                              ),
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
        const phase = reduceAgentRunTransition(run.phase, {
            type: 'error-recorded',
            terminal: input.terminal ?? false,
            hasCommittedWork: run.committedWork.length > 0,
        });
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

function applyAgentRunReceiptSagaProjection(
    run: AgentRun,
    pendingEffectRecoveryLedger: AgentRunPendingEffectRecovery[],
    projection: ReturnType<typeof projectAgentRunReceiptSaga>
): { run: AgentRun; pendingEffectRecoveryLedger: AgentRunPendingEffectRecovery[] } {
    const matchingContinuation = run.pendingEffectContinuations.find(
        (continuation) => continuation.batchId === projection.work.workId
    );
    const matchingRecovery = pendingEffectRecoveryLedger.find((recovery) =>
        isPendingEffectRecovery(recovery, { runId: run.runId, batchId: projection.work.workId })
    );
    const manualRecovery = [matchingContinuation, matchingRecovery].find(
        (recovery) => recovery?.receiptIdentity === projection.receiptIdentity && recovery.recovery === 'manual-repair'
    );
    const projectedSagaSteps = projection.sagaSteps.map((step) => {
        if (!manualRecovery || step.owner !== 'external-effect' || step.workId !== projection.work.workId) {
            return step;
        }
        const existingManualStep = run.saga.steps.find(
            (candidate) => candidate.stepId === step.stepId && candidate.state === 'manual-repair'
        );
        return existingManualStep ? structuredClone(existingManualStep) : { ...step, state: 'manual-repair' as const };
    });
    for (const step of projectedSagaSteps) {
        const existing = run.saga.steps.find((candidate) => candidate.stepId === step.stepId);
        if (existing && existing.order !== step.order) {
            throw new Error(`Agent saga step order changed: ${step.stepId}`);
        }
    }
    const sagaSteps = [
        ...run.saga.steps.filter((step) => !projectedSagaSteps.some((next) => next.stepId === step.stepId)),
        ...projectedSagaSteps.map((step) => structuredClone(step)),
    ].sort((left, right) => left.order - right.order);
    let pendingEffectContinuations = run.pendingEffectContinuations;
    let nextPendingEffectRecoveryLedger = pendingEffectRecoveryLedger;
    if (projection.pendingEffectContinuation) {
        const continuation = manualRecovery
            ? structuredClone(manualRecovery)
            : structuredClone(projection.pendingEffectContinuation);
        const createsRenderOnlyContinuation =
            manualRecovery === undefined &&
            continuation.effects.length > 0 &&
            continuation.effects.every(
                (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
            );
        const sourceRevision = createsRenderOnlyContinuation
            ? projection.work.committedRevision
            : continuation.sourceRevision;
        const continuationWithoutRecoveryIdentity = {
            authority: continuation.authority,
            batchId: continuation.batchId,
            effects: continuation.effects,
            lastError: continuation.lastError,
            receiptIdentity: continuation.receiptIdentity,
            recovery: continuation.recovery,
            serializedBatch: continuation.serializedBatch,
            ...(sourceRevision === undefined ? {} : { sourceRevision }),
        } satisfies AgentRunPendingEffectContinuation;
        pendingEffectContinuations = [
            ...run.pendingEffectContinuations.filter((continuation) => continuation.batchId !== projection.work.workId),
            continuationWithoutRecoveryIdentity,
        ];
        nextPendingEffectRecoveryLedger = [
            ...pendingEffectRecoveryLedger.filter(
                (recovery) => !isPendingEffectRecovery(recovery, { runId: run.runId, batchId: projection.work.workId })
            ),
            {
                ...continuationWithoutRecoveryIdentity,
                runId: run.runId,
                checkpoint: 'durable' as const,
            },
        ];
    } else if (projection.completesPendingEffectContinuation) {
        pendingEffectContinuations = run.pendingEffectContinuations.filter(
            (continuation) => continuation.batchId !== projection.work.workId
        );
        nextPendingEffectRecoveryLedger = pendingEffectRecoveryLedger.filter(
            (recovery) => !isPendingEffectRecovery(recovery, { runId: run.runId, batchId: projection.work.workId })
        );
    }
    const hasUnsettledExternalSagaStep = sagaSteps.some(
        (step) => step.state === 'pending' || step.state === 'external-pending' || step.state === 'uncompensated'
    );
    let phase = reduceAgentRunTransition(run.phase, {
        type: 'work-committed',
        completesRun: projection.work.completesRun !== false,
        hasUnsettledExternalSagaStep,
    });
    phase = reduceAgentRunTransition(phase, {
        type: 'saga-updated',
        hasUnsettledExternalStep: hasUnsettledExternalSagaStep,
        hasCommittedWork: true,
    });
    const hasRecoveryObligation =
        hasUnsettledExternalSagaStep ||
        pendingEffectContinuations.length > 0 ||
        run.workLeases.some((lease) => lease.terminalState === null) ||
        run.temporaryAssets.some((asset) => asset.status !== 'released') ||
        (run.manualResume.required && run.manualResume.workIds.some((workId) => workId !== projection.work.workId));
    if (projection.completesPendingEffectContinuation) {
        phase = reduceAgentRunTransition(phase, { type: 'pending-effect-completed', hasRecoveryObligation });
    }
    const committedWork = {
        workId: projection.work.workId,
        receiptIdentity: projection.work.receiptIdentity,
        revertGroupId: projection.work.revertGroupId,
        committedAt: projection.recordedAt,
    };
    return {
        run: {
            ...run,
            updatedAt: projection.recordedAt,
            phase,
            revisions: {
                ...run.revisions,
                committed: projection.work.committedRevision ?? run.revisions.committed,
            },
            receipts: [...run.receipts.filter((receipt) => receipt.workId !== projection.work.workId), committedWork],
            renders: [
                ...run.renders.filter((artifact) => !projection.work.renderJobIds.includes(artifact.artifactId)),
                ...projection.work.renderJobIds.map((artifactId) => ({
                    artifactId,
                    workId: projection.work.workId,
                    status: 'completed' as const,
                    summary: null,
                })),
            ],
            analyses: [
                ...run.analyses.filter((artifact) => !projection.work.analysisIds.includes(artifact.artifactId)),
                ...projection.work.analysisIds.map((artifactId) => ({
                    artifactId,
                    workId: projection.work.workId,
                    status: 'completed' as const,
                    summary: null,
                })),
            ],
            batches: run.batches.map((batch) =>
                batch.batchId === projection.work.workId
                    ? { ...batch, status: 'committed', receiptIdentity: projection.work.receiptIdentity }
                    : batch
            ),
            committedWork: [
                ...run.committedWork.filter((work) => work.workId !== projection.work.workId),
                committedWork,
            ],
            pendingEffectContinuations,
            manualResume:
                projection.completesPendingEffectContinuation && !hasRecoveryObligation
                    ? { required: false, reason: null, workIds: [], requiredAt: null }
                    : run.manualResume,
            saga: { schemaVersion: 1, steps: sagaSteps },
        },
        pendingEffectRecoveryLedger: nextPendingEffectRecoveryLedger,
    };
}

function recordAgentRunReceiptSaga(input: AgentRunReceiptSagaInput): { effectsPending: boolean } {
    const state = readAgentRunState();
    const runIndex = state.runs.findIndex((run) => run.runId === input.runId);
    if (runIndex < 0) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const run = state.runs[runIndex]!;
    const projection = projectAgentRunReceiptSaga({
        ...input,
        existingSagaSteps: run.saga.steps,
        hasPendingEffectRecovery:
            run.pendingEffectContinuations.some((continuation) => continuation.batchId === input.receipt.batchId) ||
            getPendingEffectRecoveryLedger(state).some((recovery) =>
                isPendingEffectRecovery(recovery, { runId: input.runId, batchId: input.receipt.batchId })
            ),
    });
    const applied = applyAgentRunReceiptSagaProjection(run, getPendingEffectRecoveryLedger(state), projection);
    const runs = [...state.runs];
    runs[runIndex] = applied.run;
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, applied.pendingEffectRecoveryLedger));
    return { effectsPending: projection.effectsPending };
}

function recordAgentRunCommittedRecoveryFailure(input: AgentRunReceiptSagaInput & { error: AgentRunError }): AgentRun {
    if (input.error.workId !== null) {
        throw new Error('Committed recovery failures cannot target the committed command batch.');
    }
    const state = readAgentRunState();
    const runIndex = state.runs.findIndex((run) => run.runId === input.runId);
    if (runIndex < 0) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const run = state.runs[runIndex]!;
    const projection = projectAgentRunReceiptSaga({
        ...input,
        existingSagaSteps: run.saga.steps,
        hasPendingEffectRecovery:
            run.pendingEffectContinuations.some((continuation) => continuation.batchId === input.receipt.batchId) ||
            getPendingEffectRecoveryLedger(state).some((recovery) =>
                isPendingEffectRecovery(recovery, { runId: input.runId, batchId: input.receipt.batchId })
            ),
        recordedAt: input.error.occurredAt,
    });
    const applied = applyAgentRunReceiptSagaProjection(run, getPendingEffectRecoveryLedger(state), projection);
    const runs = [...state.runs];
    runs[runIndex] = {
        ...applied.run,
        phase: reduceAgentRunTransition(applied.run.phase, {
            type: 'error-recorded',
            terminal: true,
            hasCommittedWork: true,
        }),
        errors: [...applied.run.errors, structuredClone(input.error)],
    };
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, applied.pendingEffectRecoveryLedger));
    return structuredClone(runs[runIndex]);
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
            phase: reduceAgentRunTransition(run.phase, {
                type: 'saga-updated',
                hasUnsettledExternalStep: hasUnsettledExternalSagaStep,
                hasCommittedWork: run.committedWork.length > 0,
            }),
            saga: { schemaVersion: 1, steps },
        };
    });
}

function projectManualRenderRepairSagaSteps(
    run: AgentRun,
    continuation: AgentRunPendingEffectContinuation,
    recordedAt: number
): AgentRunSagaStep[] {
    const commandIds = [
        ...new Set(
            continuation.effects.flatMap((effect) =>
                effect.kind === 'external-effect' &&
                effect.operation === 'renderProjectSections' &&
                effect.remediation === 'manual-repair'
                    ? [effect.commandId]
                    : []
            )
        ),
    ];
    if (commandIds.length === 0) {
        return run.saga.steps;
    }
    const targetStepIds = new Set(commandIds.map((commandId) => `effect:${continuation.batchId}:${commandId}`));
    const projectedSteps = run.saga.steps
        .filter(
            (step, index, steps) =>
                !targetStepIds.has(step.stepId) || steps.findIndex(({ stepId }) => stepId === step.stepId) === index
        )
        .map((step): AgentRunSagaStep =>
            targetStepIds.has(step.stepId)
                ? {
                      ...step,
                      owner: 'external-effect',
                      workId: continuation.batchId,
                      receiptIdentity: continuation.receiptIdentity,
                      state: 'manual-repair',
                      compensation: { ...step.compensation, available: false },
                      updatedAt: recordedAt,
                  }
                : step
        );
    let nextOrder = projectedSteps.reduce((highest, step) => Math.max(highest, step.order), -1) + 1;
    for (const commandId of commandIds) {
        const stepId = `effect:${continuation.batchId}:${commandId}`;
        if (projectedSteps.some((step) => step.stepId === stepId)) {
            continue;
        }
        projectedSteps.push({
            stepId,
            order: nextOrder,
            owner: 'external-effect',
            workId: continuation.batchId,
            receiptIdentity: continuation.receiptIdentity,
            state: 'manual-repair',
            compensation: { available: false, attempts: 0, lastError: null },
            relatedArtifactIds: [],
            updatedAt: recordedAt,
        });
        nextOrder += 1;
    }
    return projectedSteps.toSorted((left, right) => left.order - right.order);
}

function recordAgentRunPendingEffectContinuation(input: {
    runId: string;
    continuation: AgentRunPendingEffectContinuation;
    recordedAt?: number;
}): AgentRun | null {
    const recordedAt = input.recordedAt ?? Date.now();
    const state = readAgentRunState();
    const clonedContinuation = structuredClone(input.continuation);
    const committedRevision = state.runs.find((run) => run.runId === input.runId)?.revisions.committed;
    const continuation = {
        ...clonedContinuation,
        ...(clonedContinuation.sourceRevision === undefined &&
        clonedContinuation.effects.every(
            (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
        ) &&
        committedRevision
            ? { sourceRevision: committedRevision }
            : {}),
        recovery: clonedContinuation.effects.some(({ remediation }) => remediation === 'manual-repair')
            ? 'manual-repair'
            : clonedContinuation.recovery,
    } satisfies AgentRunPendingEffectContinuation;
    const existingRecovery = getPendingEffectRecoveryLedger(state).find((recovery) =>
        isPendingEffectRecovery(recovery, { runId: input.runId, batchId: continuation.batchId })
    );
    const pendingEffectRecoveryLedger: AgentRunPendingEffectRecovery[] = [
        ...getPendingEffectRecoveryLedger(state).filter(
            (recovery) => !isPendingEffectRecovery(recovery, { runId: input.runId, batchId: continuation.batchId })
        ),
        { ...structuredClone(continuation), runId: input.runId, checkpoint: 'durable' as const },
    ];
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        if (existingRecovery) {
            persistAgentRunState(withPendingEffectRecoveryLedger(state, pendingEffectRecoveryLedger));
            return null;
        }
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const current = state.runs[index]!;
    const next = {
        ...current,
        updatedAt: recordedAt,
        phase: reduceAgentRunTransition(current.phase, {
            type: 'pending-effect-recorded',
            hasCommittedWork: current.committedWork.length > 0,
        }),
        pendingEffectContinuations: [
            ...current.pendingEffectContinuations.filter((candidate) => candidate.batchId !== continuation.batchId),
            continuation,
        ],
        saga: {
            schemaVersion: 1,
            steps: projectManualRenderRepairSagaSteps(current, continuation, recordedAt),
        },
    } satisfies AgentRun;
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, pendingEffectRecoveryLedger));
    return structuredClone(next);
}

function prepareAgentRunPendingEffectContinuation(input: {
    runId: string;
    continuation: AgentRunPendingEffectContinuation;
}): void {
    const state = readAgentRunState();
    const existing = getPendingEffectRecoveryLedger(state).find((recovery) =>
        isPendingEffectRecovery(recovery, { runId: input.runId, batchId: input.continuation.batchId })
    );
    if (existing?.checkpoint === 'durable') {
        return;
    }
    const pendingEffectRecoveryLedger = [
        ...getPendingEffectRecoveryLedger(state).filter(
            (recovery) =>
                !isPendingEffectRecovery(recovery, {
                    runId: input.runId,
                    batchId: input.continuation.batchId,
                })
        ),
        { ...structuredClone(input.continuation), runId: input.runId, checkpoint: 'prepared' as const },
    ];
    persistAgentRunState(withPendingEffectRecoveryLedger(state, pendingEffectRecoveryLedger));
}

function discardPreparedAgentRunPendingEffectContinuation(input: { runId: string; batchId: string }): void {
    const state = readAgentRunState();
    const pendingEffectRecoveryLedger = getPendingEffectRecoveryLedger(state).filter(
        (recovery) => !isPendingEffectRecovery(recovery, input) || recovery.checkpoint !== 'prepared'
    );
    if (pendingEffectRecoveryLedger.length === getPendingEffectRecoveryLedger(state).length) {
        return;
    }
    persistAgentRunState(withPendingEffectRecoveryLedger(state, pendingEffectRecoveryLedger));
}

function getAgentRunPendingEffectRecovery(input: {
    runId: string;
    batchId: string;
}): AgentRunPendingEffectRecovery | null {
    const recovery = getPendingEffectRecoveryLedger(readAgentRunState()).find((candidate) =>
        isPendingEffectRecovery(candidate, input)
    );
    return recovery ? structuredClone(recovery) : null;
}

function failAgentRunPendingEffectContinuation(input: {
    runId: string;
    batchId: string;
    reason: string;
    failedAt?: number;
}): AgentRun | null {
    const failedAt = input.failedAt ?? Date.now();
    const state = readAgentRunState();
    const pendingEffectRecoveryLedger = getPendingEffectRecoveryLedger(state).map((recovery) =>
        isPendingEffectRecovery(recovery, input) ? { ...recovery, lastError: input.reason } : recovery
    );
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        persistAgentRunState(withPendingEffectRecoveryLedger(state, pendingEffectRecoveryLedger));
        return null;
    }
    const runs = [...state.runs];
    const next = {
        ...runs[index]!,
        updatedAt: failedAt,
        pendingEffectContinuations: runs[index]!.pendingEffectContinuations.map((continuation) =>
            continuation.batchId === input.batchId ? { ...continuation, lastError: input.reason } : continuation
        ),
    };
    runs[index] = next;
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, pendingEffectRecoveryLedger));
    return structuredClone(next);
}

function requireAgentRunPendingEffectManualRepair(input: {
    runId: string;
    batchId: string;
    reason: string;
    requiredAt?: number;
    preserveEffects?: boolean;
}): AgentRun {
    const requiredAt = input.requiredAt ?? Date.now();
    const state = readAgentRunState();
    const runIndex = state.runs.findIndex((run) => run.runId === input.runId);
    if (runIndex < 0) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const run = state.runs[runIndex]!;
    const continuation = run.pendingEffectContinuations.find((candidate) => candidate.batchId === input.batchId);
    const recovery = getPendingEffectRecoveryLedger(state).find((candidate) =>
        isPendingEffectRecovery(candidate, input)
    );
    if (!continuation || !recovery || recovery.checkpoint !== 'durable') {
        throw new Error(`Unknown durable pending effect continuation: ${input.batchId}`);
    }
    const requireManualRepairEffects = (effects: AgentRunPendingEffect[]): AgentRunPendingEffect[] =>
        input.preserveEffects
            ? effects
            : effects.map((effect) =>
                  effect.kind === 'external-effect' ? { ...effect, remediation: 'manual-repair' } : effect
              );
    const next = {
        ...run,
        updatedAt: requiredAt,
        saga: {
            ...run.saga,
            steps: run.saga.steps.map((step) =>
                step.owner === 'external-effect' && step.workId === input.batchId
                    ? { ...step, state: 'manual-repair', updatedAt: requiredAt }
                    : step
            ),
        },
        pendingEffectContinuations: run.pendingEffectContinuations.map((candidate) =>
            candidate.batchId === input.batchId
                ? {
                      ...candidate,
                      effects: requireManualRepairEffects(candidate.effects),
                      recovery: 'manual-repair',
                      lastError: input.reason,
                      ...(candidate.sourceRevision === undefined &&
                      run.revisions.committed &&
                      requireManualRepairEffects(candidate.effects).every(
                          (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
                      )
                          ? { sourceRevision: run.revisions.committed }
                          : {}),
                  }
                : candidate
        ),
    } satisfies AgentRun;
    const runs = [...state.runs];
    runs[runIndex] = next;
    const pendingEffectRecoveryLedger = getPendingEffectRecoveryLedger(state).map(
        (candidate): AgentRunPendingEffectRecovery =>
            isPendingEffectRecovery(candidate, input)
                ? {
                      ...candidate,
                      effects: requireManualRepairEffects(candidate.effects),
                      recovery: 'manual-repair',
                      lastError: input.reason,
                      ...(candidate.sourceRevision === undefined &&
                      run.revisions.committed &&
                      requireManualRepairEffects(candidate.effects).every(
                          (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
                      )
                          ? { sourceRevision: run.revisions.committed }
                          : {}),
                  }
                : candidate
    );
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, pendingEffectRecoveryLedger));
    return structuredClone(next);
}

function completeAgentRunPendingEffectContinuation(input: {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    completedAt?: number;
}): AgentRun | null {
    const completedAt = input.completedAt ?? Date.now();
    const state = readAgentRunState();
    const completedRecovery = getPendingEffectRecoveryLedger(state).find((recovery) =>
        isPendingEffectRecovery(recovery, input)
    );
    const pendingEffectRecoveryLedger = getPendingEffectRecoveryLedger(state).filter(
        (recovery) => !isPendingEffectRecovery(recovery, input)
    );
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        if (!completedRecovery) {
            throw new Error(`Unknown pending effect continuation: ${input.batchId}`);
        }
        persistAgentRunState(withPendingEffectRecoveryLedger(state, pendingEffectRecoveryLedger));
        return null;
    }
    const run = structuredClone(state.runs[index]!);
    const completedContinuation =
        run.pendingEffectContinuations.find((continuation) => continuation.batchId === input.batchId) ??
        completedRecovery;
    if (!completedContinuation) {
        if (hasExactlySettledPendingEffectContinuation(run, input)) {
            persistAgentRunState(state);
            return structuredClone(run);
        }
        throw new Error(`Unknown pending effect continuation: ${input.batchId}`);
    }
    const pendingEffectContinuations = run.pendingEffectContinuations.filter(
        (continuation) => continuation.batchId !== input.batchId
    );
    const steps = run.saga.steps.map((step) =>
        step.owner === 'external-effect' && step.workId === input.batchId
            ? {
                  ...step,
                  receiptIdentity: input.receiptIdentity,
                  state: 'committed' as const,
                  updatedAt: completedAt,
              }
            : step
    );
    const hasUnsettledSaga = steps.some(
        (step) =>
            step.state === 'pending' ||
            step.state === 'external-pending' ||
            step.state === 'uncompensated' ||
            step.state === 'manual-repair'
    );
    const hasUnsettledWorkLease = run.workLeases.some((lease) => lease.terminalState === null);
    const hasTemporaryAsset = run.temporaryAssets.some((asset) => asset.status !== 'released');
    const hasIndependentManualResume =
        run.manualResume.required && run.manualResume.workIds.some((workId) => workId !== input.batchId);
    const hasRecoveryObligation =
        hasUnsettledSaga ||
        pendingEffectContinuations.length > 0 ||
        hasUnsettledWorkLease ||
        hasTemporaryAsset ||
        hasIndependentManualResume;
    const priorLedgerEntry =
        run.receipts.find((receipt) => receipt.workId === input.batchId) ??
        run.committedWork.find((work) => work.workId === input.batchId);
    const completedLedgerEntry = {
        workId: input.batchId,
        receiptIdentity: input.receiptIdentity,
        revertGroupId: priorLedgerEntry?.revertGroupId ?? null,
        committedAt: priorLedgerEntry?.committedAt ?? completedAt,
    };
    const batches = run.batches.some((batch) => batch.batchId === input.batchId)
        ? run.batches.map((batch) =>
              batch.batchId === input.batchId
                  ? { ...batch, status: 'committed' as const, receiptIdentity: input.receiptIdentity }
                  : batch
          )
        : [
              ...run.batches,
              {
                  batchId: input.batchId,
                  commandIds: completedContinuation.effects.map(({ commandId }) => commandId),
                  status: 'committed' as const,
                  receiptIdentity: input.receiptIdentity,
              },
          ];
    const next = {
        ...run,
        updatedAt: completedAt,
        phase: reduceAgentRunTransition(run.phase, {
            type: 'pending-effect-completed',
            hasRecoveryObligation,
        }),
        batches,
        receipts: [...run.receipts.filter((receipt) => receipt.workId !== input.batchId), completedLedgerEntry],
        committedWork: [...run.committedWork.filter((work) => work.workId !== input.batchId), completedLedgerEntry],
        pendingEffectContinuations,
        manualResume: hasRecoveryObligation
            ? run.manualResume
            : { required: false, reason: null, workIds: [], requiredAt: null },
        saga: { schemaVersion: 1, steps },
    } satisfies AgentRun;
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, pendingEffectRecoveryLedger));
    return structuredClone(next);
}

function settleAgentRunPendingEffectManualReview(input: {
    runId: string;
    batchId: string;
    receiptIdentity: string;
    sourceRevision: string;
    disposition: 'accepted' | 'discarded' | 'missing-evidence';
    settledAt?: number;
}): AgentRun {
    const settledAt = input.settledAt ?? Date.now();
    const state = readAgentRunState();
    const runIndex = state.runs.findIndex((run) => run.runId === input.runId);
    if (runIndex < 0) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const run = state.runs[runIndex]!;
    const continuation = run.pendingEffectContinuations.find((candidate) => candidate.batchId === input.batchId);
    const recovery = getPendingEffectRecoveryLedger(state).find((candidate) =>
        isPendingEffectRecovery(candidate, input)
    );
    if (
        !continuation ||
        !recovery ||
        !hasSamePendingEffectManualReviewBinding(continuation, recovery) ||
        continuation.receiptIdentity !== input.receiptIdentity ||
        recovery.receiptIdentity !== input.receiptIdentity ||
        continuation.recovery !== 'manual-repair' ||
        continuation.sourceRevision !== input.sourceRevision ||
        continuation.effects.some(
            (effect) =>
                effect.kind !== 'external-effect' ||
                effect.operation !== 'renderProjectSections' ||
                effect.remediation !== 'manual-repair'
        )
    ) {
        throw new Error('The exact manual-review obligation is stale or unavailable.');
    }
    const targetStepIds = getExactPendingEffectManualReviewSagaStepIds(run, continuation);
    if (!targetStepIds) {
        throw new Error('The exact manual-review obligation is stale or unavailable.');
    }
    const pendingEffectContinuations = run.pendingEffectContinuations.filter(
        (candidate) => candidate.batchId !== input.batchId
    );
    const steps = run.saga.steps.map((step) =>
        targetStepIds.has(step.stepId)
            ? { ...step, state: 'reviewed' as const, manualReviewDisposition: input.disposition, updatedAt: settledAt }
            : step
    );
    const remainingManualResumeWorkIds = run.manualResume.workIds.filter((workId) => workId !== input.batchId);
    const hasRecoveryObligation =
        steps.some(
            (step) =>
                step.state === 'pending' ||
                step.state === 'external-pending' ||
                step.state === 'uncompensated' ||
                step.state === 'manual-repair'
        ) ||
        pendingEffectContinuations.length > 0 ||
        run.workLeases.some((lease) => lease.terminalState === null) ||
        run.temporaryAssets.some((asset) => asset.status !== 'released') ||
        remainingManualResumeWorkIds.length > 0;
    const runs = [...state.runs];
    runs[runIndex] = {
        ...run,
        updatedAt: settledAt,
        phase: reduceAgentRunTransition(run.phase, { type: 'pending-effect-completed', hasRecoveryObligation }),
        pendingEffectContinuations,
        manualResume:
            remainingManualResumeWorkIds.length > 0
                ? { ...run.manualResume, required: true, workIds: remainingManualResumeWorkIds }
                : { required: false, reason: null, workIds: [], requiredAt: null },
        saga: { schemaVersion: 1, steps },
    } satisfies AgentRun;
    const pendingEffectRecoveryLedger = getPendingEffectRecoveryLedger(state).filter(
        (candidate) => !isPendingEffectRecovery(candidate, input)
    );
    try {
        persistAgentRunState(withPendingEffectRecoveryLedger({ ...state, runs }, pendingEffectRecoveryLedger));
    } catch (error) {
        try {
            persistAgentRunState(state);
        } catch {
            // The original durable state remains authoritative even when restoring the live cache also cannot persist.
        }
        throw error;
    }
    return structuredClone(runs[runIndex]);
}

function hasExactlySettledPendingEffectContinuation(
    run: AgentRun,
    input: { batchId: string; receiptIdentity: string }
): boolean {
    const hasExactEntry = (entries: readonly { workId: string; receiptIdentity: string }[]) => {
        const matches = entries.filter(({ workId }) => workId === input.batchId);
        return matches.length === 1 && matches[0]?.receiptIdentity === input.receiptIdentity;
    };
    const batches = run.batches.filter(({ batchId }) => batchId === input.batchId);
    const sagaSteps = run.saga.steps.filter(
        (step) => step.owner === 'external-effect' && step.workId === input.batchId
    );
    return (
        run.pendingEffectContinuations.every(({ batchId }) => batchId !== input.batchId) &&
        hasExactEntry(run.receipts) &&
        hasExactEntry(run.committedWork) &&
        batches.length === 1 &&
        batches[0]?.status === 'committed' &&
        batches[0].receiptIdentity === input.receiptIdentity &&
        sagaSteps.length === 1 &&
        sagaSteps[0]?.state === 'committed' &&
        sagaSteps[0].receiptIdentity === input.receiptIdentity
    );
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
        const phase = reduceAgentRunTransition(run.phase, {
            type: 'work-committed',
            completesRun: input.completesRun !== false,
            hasUnsettledExternalSagaStep,
        });
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
}): AgentRun | null {
    const recordedAt = input.recordedAt ?? Date.now();
    const state = readAgentRunState();
    const recovery = structuredClone(input.recovery);
    const existingRecovery = getPreparedStemImportRecoveryLedger(state).find((candidate) =>
        isPreparedStemImportRecovery(candidate, { runId: input.runId, batchId: recovery.batchId })
    );
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0 && (!existingRecovery || !hasSamePreparedStemImportRecovery(existingRecovery, recovery))) {
        throw new Error(`Unknown agent run prepared-stem recovery: ${input.runId}:${input.recovery.batchId}`);
    }
    const nextRun = (() => {
        if (index < 0) {
            return null;
        }
        const run = state.runs[index]!;
        const resourceIds = new Set(recovery.resources.map((resource) => resource.audioBufferId));
        const otherRecoveryResourceIds = new Set(
            run.preparedStemImports
                .filter((candidate) => candidate.batchId !== recovery.batchId)
                .flatMap((candidate) => candidate.resources.map((resource) => resource.audioBufferId))
        );
        if (
            resourceIds.size !== recovery.resources.length ||
            recovery.resources.some((resource) => otherRecoveryResourceIds.has(resource.audioBufferId)) ||
            recovery.resources.some(
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
            throw new Error(`Prepared stem recovery does not match live run assets: ${recovery.batchId}`);
        }
        return {
            ...run,
            updatedAt: recordedAt,
            preparedStemImports: [
                ...run.preparedStemImports.filter((candidate) => candidate.batchId !== recovery.batchId),
                recovery,
            ],
        } satisfies AgentRun;
    })();
    const preparedStemImportRecoveryLedger = [
        ...getPreparedStemImportRecoveryLedger(state).filter(
            (candidate) => !isPreparedStemImportRecovery(candidate, { runId: input.runId, batchId: recovery.batchId })
        ),
        {
            ...structuredClone(recovery),
            runId: input.runId,
            status: existingRecovery?.status ?? ('pending' as const),
            lastError: existingRecovery?.lastError ?? null,
            manualRepairRequiredAt: existingRecovery?.manualRepairRequiredAt ?? null,
        },
    ];
    const runs = [...state.runs];
    if (nextRun) {
        runs[index] = nextRun;
    }
    persistAgentRunState(withPreparedStemImportRecoveryLedger({ ...state, runs }, preparedStemImportRecoveryLedger));
    return nextRun ? structuredClone(nextRun) : null;
}

function forgetAgentRunPreparedStemImportRecovery(input: { runId: string; batchId: string }): AgentRun | null {
    const state = readAgentRunState();
    const preparedStemImportRecoveryLedger = getPreparedStemImportRecoveryLedger(state).filter(
        (candidate) => !isPreparedStemImportRecovery(candidate, input)
    );
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        if (preparedStemImportRecoveryLedger.length === getPreparedStemImportRecoveryLedger(state).length) {
            return null;
        }
        persistAgentRunState(withPreparedStemImportRecoveryLedger(state, preparedStemImportRecoveryLedger));
        return null;
    }
    const next = {
        ...state.runs[index]!,
        updatedAt: Date.now(),
        preparedStemImports: state.runs[index]!.preparedStemImports.filter(
            (recovery) => recovery.batchId !== input.batchId
        ),
    } satisfies AgentRun;
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState(withPreparedStemImportRecoveryLedger({ ...state, runs }, preparedStemImportRecoveryLedger));
    return structuredClone(next);
}

function getAgentRunPreparedStemImportRecovery(input: {
    runId: string;
    batchId: string;
}): AgentRunPreparedStemImportRecoveryCapsule | null {
    const recovery = getPreparedStemImportRecoveryLedger(readAgentRunState()).find((candidate) =>
        isPreparedStemImportRecovery(candidate, input)
    );
    return recovery ? structuredClone(recovery) : null;
}

function requireAgentRunPreparedStemManualRepair(input: {
    runId: string;
    assetIds: string[];
    batchIds: string[];
    reason?: string;
    requiredAt?: number;
}): AgentRun | null {
    const requiredAt = input.requiredAt ?? Date.now();
    const reason =
        input.reason ??
        'Prepared stem cleanup identity is unavailable. Keep the staged media retained and inspect it manually.';
    const state = readAgentRunState();
    const matchingBatchIds = new Set(input.batchIds);
    const preparedStemImportRecoveryLedger = getPreparedStemImportRecoveryLedger(state).map((recovery) =>
        recovery.runId === input.runId && matchingBatchIds.has(recovery.batchId)
            ? {
                  ...recovery,
                  status: 'manual-repair' as const,
                  lastError: reason,
                  manualRepairRequiredAt: requiredAt,
              }
            : recovery
    );
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        if (
            input.batchIds.length === 0 ||
            preparedStemImportRecoveryLedger.every(
                (recovery) => recovery.runId !== input.runId || !matchingBatchIds.has(recovery.batchId)
            )
        ) {
            throw new Error(`Unknown agent run prepared-stem recovery: ${input.runId}`);
        }
        persistAgentRunState(withPreparedStemImportRecoveryLedger(state, preparedStemImportRecoveryLedger));
        return null;
    }
    const run = state.runs[index]!;
    const next = run.errors.some((error) => error.code === 'prepared-stem-recovery-metadata-missing')
        ? { ...run, updatedAt: requiredAt }
        : {
              ...run,
              updatedAt: requiredAt,
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
                  reason,
                  workIds: [...new Set([...run.manualResume.workIds, ...input.batchIds])],
                  requiredAt,
              },
          };
    const runs = [...state.runs];
    runs[index] = next;
    persistAgentRunState(withPreparedStemImportRecoveryLedger({ ...state, runs }, preparedStemImportRecoveryLedger));
    return structuredClone(next);
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

function transferAgentRunPreparedStemImportResources(input: {
    runId: string;
    assets: readonly { assetId: string; cleanupOwner: string }[];
    recoveryBatchIds: readonly string[];
}): AgentRun {
    const assetKeys = new Set(input.assets.map((asset) => `${asset.assetId}\u0000${asset.cleanupOwner}`));
    if (assetKeys.size !== input.assets.length) {
        throw new Error(`Agent temporary assets contain duplicate cleanup identities: ${input.runId}`);
    }
    const recoveryBatchIds = new Set(input.recoveryBatchIds);
    if (recoveryBatchIds.size !== input.recoveryBatchIds.length) {
        throw new Error(`Agent prepared stem recoveries contain duplicate batch identities: ${input.runId}`);
    }
    const state = readAgentRunState();
    const index = state.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
        throw new Error(`Unknown agent run: ${input.runId}`);
    }
    const run = state.runs[index]!;
    const assetsStillPresent = input.assets.some((asset) =>
        run.temporaryAssets.some(
            (candidate) => candidate.assetId === asset.assetId && candidate.cleanupOwner === asset.cleanupOwner
        )
    );
    const recoveriesStillPresent =
        run.preparedStemImports.some((recovery) => recoveryBatchIds.has(recovery.batchId)) ||
        getPreparedStemImportRecoveryLedger(state).some(
            (recovery) => recovery.runId === input.runId && recoveryBatchIds.has(recovery.batchId)
        );
    if (!assetsStillPresent && !recoveriesStillPresent) {
        // `trySet` keeps a rejected state live. Persisting that exact snapshot
        // retries the transfer without detaching its still-registered cleanup owners.
        persistAgentRunState(state);
        return structuredClone(run);
    }
    for (const asset of input.assets) {
        const current = run.temporaryAssets.find((candidate) => candidate.assetId === asset.assetId);
        if (!current || current.cleanupOwner !== asset.cleanupOwner) {
            throw new Error(`Unknown agent temporary asset: ${asset.assetId}`);
        }
    }
    const next = {
        ...run,
        updatedAt: Date.now(),
        temporaryAssets: run.temporaryAssets.filter(
            (asset) => !assetKeys.has(`${asset.assetId}\u0000${asset.cleanupOwner}`)
        ),
        preparedStemImports: run.preparedStemImports.filter((recovery) => !recoveryBatchIds.has(recovery.batchId)),
    } satisfies AgentRun;
    const runs = [...state.runs];
    runs[index] = next;
    const preparedStemImportRecoveryLedger = getPreparedStemImportRecoveryLedger(state).filter(
        (recovery) => recovery.runId !== input.runId || !recoveryBatchIds.has(recovery.batchId)
    );
    persistAgentRunState(withPreparedStemImportRecoveryLedger({ ...state, runs }, preparedStemImportRecoveryLedger));
    return structuredClone(next);
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
            phase: reduceAgentRunTransition(run.phase, { type: 'manual-resume-required' }),
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
            phase: reduceAgentRunTransition(run.phase, {
                type: 'cancellation-requested',
                hasCommittedWork: run.committedWork.length > 0,
            }),
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

function recoverInterruptedAgentRunState(input?: { recoveredAt?: number }): { recoveredRunIds: string[] } {
    const recoveredAt = input?.recoveredAt ?? Date.now();
    const current = readAgentRunState();
    const recovery = recoverInterruptedRunState(current, recoveredAt);
    if (recovery.recoveredRunIds.length > 0) {
        persistAgentRunState(recovery.state);
    }
    return { recoveredRunIds: recovery.recoveredRunIds };
}

type ClaimAgentRunWorkLeaseResult = ClaimWorkLeaseResult | { status: 'missing-run' };

function claimAgentRunWorkLease(input: {
    runId: string;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    idempotencyKey: string;
    receiptIdentity: string;
    idempotent: boolean;
    retriable: boolean;
    operation?: 'read' | 'write';
    claimedAt?: number;
}): ClaimAgentRunWorkLeaseResult {
    const claimedAt = input.claimedAt ?? Date.now();
    let result: ClaimAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateAgentRunIfPresent(input.runId, claimedAt, (run) => {
        const outcome = claimWorkLease({ ...input, run, claimedAt });
        result = outcome.result;
        return outcome.run;
    });
    return updated === null ? { status: 'missing-run' as const } : result;
}

type RetryAgentRunWorkLeaseResult = RetryWorkLeaseResult | { status: 'missing-run' };

function retryAgentRunWorkLease(input: {
    runId: string;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    claimedAt?: number;
}): RetryAgentRunWorkLeaseResult {
    const claimedAt = input.claimedAt ?? Date.now();
    let result: RetryAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateAgentRunIfPresent(input.runId, claimedAt, (run) => {
        const outcome = retryWorkLease({ ...input, run, claimedAt });
        result = outcome.result;
        return outcome.run;
    });
    return updated === null ? { status: 'missing-run' as const } : result;
}

type SettleAgentRunWorkLeaseResult = SettleWorkLeaseResult | { status: 'missing-run' | 'missing-batch' };

type AgentRunCommandTerminalOutcome = 'failed' | 'ambiguous' | 'no-op';

const COMMAND_TERMINAL_OUTCOMES = {
    failed: {
        terminalState: 'failed',
        batchStatus: 'failed',
        phase: 'failed',
    },
    ambiguous: {
        terminalState: 'failed',
        batchStatus: 'failed',
        phase: 'partially-completed',
    },
    'no-op': {
        terminalState: 'completed',
        batchStatus: 'no-op',
        phase: 'completed',
    },
} as const satisfies Record<
    AgentRunCommandTerminalOutcome,
    {
        terminalState: AgentRunWorkTerminalState;
        batchStatus: 'failed' | 'no-op';
        phase: Extract<AgentRunPhase, 'completed' | 'failed' | 'partially-completed'>;
    }
>;

function getAgentRunCommandTerminalOutcome(outcome: AgentRunCommandTerminalOutcome) {
    return COMMAND_TERMINAL_OUTCOMES[outcome];
}

function settleAgentRunWorkLease(input: {
    runId: string;
    workId: string;
    leaseId: string;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    terminalState: AgentRunWorkTerminalState;
    settledAt?: number;
}): SettleAgentRunWorkLeaseResult {
    const settledAt = input.settledAt ?? Date.now();
    let result: SettleAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateAgentRunIfPresent(input.runId, settledAt, (run) => {
        const outcome = settleWorkLease({ ...input, run, settledAt });
        result = outcome.result;
        return outcome.run;
    });
    return updated === null ? { status: 'missing-run' as const } : result;
}

function settleAgentRunWorkLeaseAndTerminalize(input: {
    runId: string;
    workId: string;
    leaseId: string;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    outcome: AgentRunCommandTerminalOutcome;
    settledAt?: number;
}): SettleAgentRunWorkLeaseResult {
    const settledAt = input.settledAt ?? Date.now();
    const current = readAgentRunState().runs.find((run) => run.runId === input.runId);
    if (!current) {
        return { status: 'missing-run' };
    }
    if (!current.batches.some((batch) => batch.batchId === input.workId)) {
        return { status: 'missing-batch' };
    }
    const terminal = getAgentRunCommandTerminalOutcome(input.outcome);
    let result: SettleAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateAgentRunIfPresent(input.runId, settledAt, (run) => {
        const outcome = settleWorkLease({ ...input, terminalState: terminal.terminalState, run, settledAt });
        result = outcome.result;
        if (outcome.result.status !== 'settled') {
            return outcome.run;
        }
        return {
            ...outcome.run,
            batches: outcome.run.batches.map((batch) =>
                batch.batchId === input.workId ? { ...batch, status: terminal.batchStatus } : batch
            ),
            phase: reduceAgentRunTransition(outcome.run.phase, { type: 'phase-requested', phase: terminal.phase }),
        };
    });
    return updated === null ? { status: 'missing-run' as const } : result;
}

export const agentRunLifecycle = {
    acknowledgeCancellation: acknowledgeAgentRunCancellation,
    cancel: cancelAgentRun,
    clear: clearAgentRuns,
    claimDecisionResume: claimAgentRunDecisionResume,
    claimWorkLease: claimAgentRunWorkLease,
    create: createAgentRun,
    get: getAgentRun,
    getCommandTerminalOutcome: getAgentRunCommandTerminalOutcome,
    getPendingEffectRecovery: getAgentRunPendingEffectRecovery,
    getPreparedStemImportRecovery: getAgentRunPreparedStemImportRecovery,
    forgetTemporaryAsset: forgetAgentRunTemporaryAsset,
    transferPreparedStemImportResources: transferAgentRunPreparedStemImportResources,
    forgetPreparedStemImportRecovery: forgetAgentRunPreparedStemImportRecovery,
    recordArtifact: recordAgentRunArtifact,
    recordBatch: recordAgentRunBatch,
    recordCommittedWork: recordAgentRunCommittedWork,
    recordCommittedRecoveryFailure: recordAgentRunCommittedRecoveryFailure,
    recordReceiptSaga: recordAgentRunReceiptSaga,
    recordContextEvidence: recordAgentRunContextEvidence,
    recordError: recordAgentRunError,
    recordPendingEffectContinuation: recordAgentRunPendingEffectContinuation,
    preparePendingEffectContinuation: prepareAgentRunPendingEffectContinuation,
    discardPreparedPendingEffectContinuation: discardPreparedAgentRunPendingEffectContinuation,
    failPendingEffectContinuation: failAgentRunPendingEffectContinuation,
    requirePendingEffectManualRepair: requireAgentRunPendingEffectManualRepair,
    completePendingEffectContinuation: completeAgentRunPendingEffectContinuation,
    settlePendingEffectManualReview: settleAgentRunPendingEffectManualReview,
    recordSagaStep: recordAgentRunSagaStep,
    recordSagaCompensation: recordAgentRunSagaCompensation,
    recordApplicationToolEvidence: recordAgentRunApplicationToolEvidence,
    recordPlan: recordAgentRunPlan,
    recordDecision: recordAgentRunDecision,
    recordProviderUsage: recordAgentRunProviderUsage,
    recordPreparedStemImportRecovery: recordAgentRunPreparedStemImportRecovery,
    reconcileBudgetAttempt: reconcileAgentRunBudgetAttempt,
    recoverInterruptedState: recoverInterruptedAgentRunState,
    reserveBudget: reserveAgentRunBudget,
    reserveBudgetBatch: reserveAgentRunBudgetBatch,
    selectDecisionAlternative: selectAgentRunDecisionAlternative,
    releaseDecisionResumeClaim: releaseAgentRunDecisionResumeClaim,
    releaseTemporaryAsset: releaseAgentRunTemporaryAsset,
    prepareTemporaryAssetCleanup: prepareAgentRunTemporaryAssetCleanup,
    registerTemporaryAsset: registerAgentRunTemporaryAsset,
    requireManualResume: requireAgentRunManualResume,
    requirePreparedStemManualRepair: requireAgentRunPreparedStemManualRepair,
    retryWorkLease: retryAgentRunWorkLease,
    retryPersistence: retryAgentRunPersistence,
    settleWorkLease: settleAgentRunWorkLease,
    settleWorkLeaseAndTerminalize: settleAgentRunWorkLeaseAndTerminalize,
    transitionPhase: transitionAgentRunPhase,
    updateBatchStatus: updateAgentRunBatchStatus,
} as const;
