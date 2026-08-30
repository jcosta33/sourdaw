import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { AiProposalInvalidatedError } from '../../../errors/AiProposalInvalidatedError';
import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { settleConfirmedCommandExecution } from '../settleConfirmedCommandExecution';

const mocks = vi.hoisted(() => ({
    completeNoOp: vi.fn(),
    createCommittedEffectFailure: vi.fn((receipt, reason) => ({
        status: 'failed',
        durableCommit: true,
        receipt,
        reason,
    })),
    createFinalizationFailure: vi.fn((reason) => ({ status: 'failed', durableCommit: true, reason })),
    getReplayDisposition: vi.fn(() => ({ status: 'executed' })),
    invalidate: vi.fn(async () => ({ status: 'invalidated', reason: 'project changed' })),
    cancel: vi.fn(async () => ({ status: 'cancelled' })),
    loggerError: vi.fn(),
    message: vi.fn(),
    recordCommittedRecoveryFailure: vi.fn(() => null),
    recordFailure: vi.fn(() => null),
    reconcileBudget: vi.fn(() => null),
    recoverStemResources: vi.fn(),
    retainResources: vi.fn(),
    settleLease: vi.fn((): { accepted: boolean; warning: string | null } => ({ accepted: true, warning: null })),
    settleResources: vi.fn(),
    settleBatchOutcome: vi.fn(async () => ({ status: 'executed' })),
    settleReplay: vi.fn(async () => ({ status: 'executed' })),
    status: vi.fn(),
    followUp: vi.fn(),
    requireManualRepair: vi.fn(() => null),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    parseVersionedCommandBatchEnvelope: vi.fn(() => ({ status: 'valid', envelope: { commands: [] } })),
}));
vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.message }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    updatePendingActionConfirmationStatus: mocks.status,
    updatePendingActionFollowUp: mocks.followUp,
}));
vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        getPendingEffectRecovery: vi.fn(),
        requirePendingEffectManualRepair: vi.fn(),
    },
}));
vi.mock('../../agentRunWorkLease', () => ({ agentRunWorkLease: { settle: vi.fn() } }));
vi.mock('../../getExactAgentActionHash', () => ({ getExactAgentActionHash: vi.fn() }));
vi.mock('../../getVerifiedBatchReplayDisposition', () => ({
    getVerifiedBatchReplayDisposition: mocks.getReplayDisposition,
}));
vi.mock('../../recoverPreparedStemImportResources', () => ({
    recoverPreparedStemImportResources: mocks.recoverStemResources,
}));
vi.mock('../agentRunExecutionSettlement', () => ({
    agentRunExecutionSettlement: {
        completeNoOp: mocks.completeNoOp,
        reconcileCommandBudget: mocks.reconcileBudget,
        recordCommittedRecoveryFailure: mocks.recordCommittedRecoveryFailure,
        recordFailure: mocks.recordFailure,
    },
}));
vi.mock('../confirmationTerminalSettlement', () => ({
    confirmationTerminalSettlement: {
        cancelAcceptedConfirmation: mocks.cancel,
        invalidateForProjectChange: mocks.invalidate,
    },
}));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: mocks.createCommittedEffectFailure,
        createCommittedFinalizationEvidenceFailureResult: mocks.createFinalizationFailure,
    },
}));
vi.mock('../pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: {
        retainCommitted: mocks.retainResources,
        settleBestEffort: mocks.settleResources,
    },
}));
vi.mock('../requireSectionRenderManualRepair', () => ({ requireSectionRenderManualRepair: mocks.requireManualRepair }));
vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    AGENT_RUN_PERSISTENCE_WARNING: 'persistence warning',
    settleAgentRunWorkLeaseSafely: mocks.settleLease,
}));
vi.mock('../settleConfirmedBatchOutcome', () => ({ settleConfirmedBatchOutcome: mocks.settleBatchOutcome }));
vi.mock('../settleVerifiedBatchReplay', () => ({ settleVerifiedBatchReplay: mocks.settleReplay }));

type Input = Parameters<typeof settleConfirmedCommandExecution>[0];
type ReadyAdmission = Input['executionAdmission'];
type CompletedFlight = Extract<Input['executionFlight'], { status: 'completed' }>;
type CompletedBatchResult = CompletedFlight['batchResult'];
type AddDeviceAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'addDevice' }>;

const action = {
    type: 'addDevice',
    payload: {
        trackId: 'track-a',
        deviceType: 'builtin-compressor',
        deviceId: 'device-a',
        expectedDeviceIds: [],
        expectedFrozen: false,
    },
} satisfies AddDeviceAction;

const batchEnvelope = {
    schemaVersion: 1,
    runId: 'run-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    baseRevision: 'revision-1',
    idempotencyKey: 'key-1',
    intent: 'Add an effect',
    mode: 'commit',
    scope: { targetIds: ['track-a'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    preconditions: [],
    commands: [
        {
            schemaVersion: 1,
            commandId: 'command-1',
            issuedAt: 0,
            operation: 'addDevice',
            arguments: action.payload,
            argumentsDigest: 'digest-1',
            groupId: 'batch-1',
            dependencyIds: [],
            reason: 'Add an effect',
            expectedEffect: 'A compressor is added.',
            objectReferences: [{ argument: 'trackId', id: 'track-a', scope: 'stable' }],
            time: [],
            parameterUnits: [],
            seed: null,
            normalizedProjectRevision: 'revision-1',
            availableDeviceVersions: {},
            applicationAssignedIds: [],
        },
    ],
    postconditions: [],
    dependencies: [],
    batchLocalBindings: [],
    grants: {
        allowedOperationPrefixes: ['addDevice'],
        create: false,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    },
    budgets: {
        maxCommands: 1,
        maxCreatedTracks: 0,
        maxDeletedObjects: 0,
        maxAffectedTracks: 1,
        maxAffectedClips: 0,
        maxAutomationPoints: 0,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
    },
} satisfies Parameters<typeof createVerifiedBatchReceipt>[0]['envelope'];

const commandBatch = {
    serialized: 'serialized',
    authority: {
        projectId: 'project-1',
        baseRevision: 'revision-1',
        scope: { targetIds: ['track-a'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: batchEnvelope.grants,
        budgets: batchEnvelope.budgets,
    },
} satisfies ReadyAdmission['commandBatch'];

const confirmation = {
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Add an effect',
    assistantMessageId: 'assistant-1',
    actionLabels: ['Add compressor'],
    affectedIds: ['track-a'],
    protectedUnchanged: [],
    risk: null,
    executedActions: [],
    status: 'proposed',
    error: null,
    followUpProjectRevision: null,
    followUpStatus: null,
    createdAt: 0,
    resolvedAt: null,
    kind: 'app_actions',
    projectRevision: 'revision-1',
    actions: [action],
    approvalSnapshot: {
        actions: [action],
        actionLabels: ['Add compressor'],
        commandBatch,
        protectedUnchanged: [],
    },
    executionMode: 'atomic',
    groupId: 'batch-1',
    groupLabel: 'Batch',
} satisfies PendingAppActionConfirmation;

const trackedWorkLease = {
    leaseId: 'lease-1',
    runId: 'run-1',
    workId: 'work-1',
    attempt: 1,
    ownerKind: 'command',
    cancellationGeneration: 0,
    idempotencyKey: 'key-1',
    receiptIdentity: 'receipt-1',
    cleanupOwner: 'command',
    idempotent: true,
    retriable: false,
    claimedAt: 0,
    terminalState: null,
    settledAt: null,
} satisfies NonNullable<ReadyAdmission['trackedWorkLease']>;

function createReceipt(result: Parameters<typeof createVerifiedBatchReceipt>[0]['result']) {
    return createVerifiedBatchReceipt({
        contentHash: 'content-hash',
        envelope: batchEnvelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-1',
        result,
    });
}

function createEmptyActions(): [] {
    return [];
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolveDeferred: (value: T | PromiseLike<T>) => void = () => {
        throw new Error('Expected the deferred promise resolver.');
    };
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function observeSettlement<T>(promise: Promise<T>): {
    isSettled: () => boolean;
    completion: Promise<void>;
} {
    let settled = false;
    const completion = promise.then(() => {
        settled = true;
    });
    return { isSettled: () => settled, completion };
}

function createCommittedBatchResult(): CompletedBatchResult {
    const result = { status: 'committed', actions: createEmptyActions() } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createCommittedWithWarningBatchResult(): CompletedBatchResult {
    type CommittedWithWarningBatchResult = Extract<CompletedBatchResult, { status: 'committed-with-warning' }>;
    const commandReceipt = {
        commandId: 'command-1',
        schemaVersion: 1,
        applicationAssigned: { ids: [], timestamps: [] },
    } satisfies NonNullable<CommittedWithWarningBatchResult['actions'][number]['receipt']>;
    const result = {
        status: 'committed-with-warning',
        actions: [
            {
                action,
                label: 'Add compressor',
                receipt: commandReceipt,
            },
        ],
        warning: 'effect pending',
    } satisfies Omit<CommittedWithWarningBatchResult, 'receipt'>;
    const receiptObservation = {
        status: 'committed-with-warning',
        actions: [{ action, receipt: commandReceipt }],
        warning: 'effect pending',
    } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(receiptObservation) } satisfies CompletedBatchResult;
}

function createExecutedWithWarningBatchResult(): Extract<CompletedBatchResult, { status: 'executed-with-warning' }> {
    const result = {
        status: 'executed-with-warning',
        actions: createEmptyActions(),
        warning: 'runtime follow-up pending',
    } satisfies Parameters<typeof createReceipt>[0];
    return {
        ...result,
        receipt: createReceipt(result),
    } satisfies Extract<CompletedBatchResult, { status: 'executed-with-warning' }>;
}

function createExecutedBatchResult(): CompletedBatchResult {
    const result = { status: 'executed', actions: createEmptyActions() } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createNoOpBatchResult(): CompletedBatchResult {
    const result = { status: 'no-op', actions: createEmptyActions() } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createIdempotentReplayBatchResult(): Extract<CompletedBatchResult, { status: 'idempotent-replay' }> {
    const observedResult = { status: 'executed', actions: createEmptyActions() } satisfies Parameters<
        typeof createReceipt
    >[0];
    return {
        status: 'idempotent-replay',
        actions: createEmptyActions(),
        receipt: createReceipt(observedResult),
    } satisfies Extract<CompletedBatchResult, { status: 'idempotent-replay' }>;
}

function createFailedBatchResult(): CompletedBatchResult {
    const result = {
        status: 'failed',
        reason: 'precondition failed',
        actions: createEmptyActions(),
    } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createConflictedBatchResult(): CompletedBatchResult {
    const result = {
        status: 'conflicted',
        reason: 'precondition failed',
        actions: createEmptyActions(),
    } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createRejectedBatchResult(): CompletedBatchResult {
    const result = {
        status: 'rejected',
        reason: 'precondition failed',
        actions: createEmptyActions(),
    } satisfies Parameters<typeof createReceipt>[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createAmbiguousBatchResult(): CompletedBatchResult {
    const result = { status: 'ambiguous', reason: 'partial write', actions: createEmptyActions() } satisfies Parameters<
        typeof createReceipt
    >[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

function createCancelledBatchResult(): CompletedBatchResult {
    const result = { status: 'cancelled', reason: 'cancelled', actions: createEmptyActions() } satisfies Parameters<
        typeof createReceipt
    >[0];
    return { ...result, receipt: createReceipt(result) } satisfies CompletedBatchResult;
}

type LeaseSettlementCase = {
    status: CompletedBatchResult['status'];
    createBatchResult: () => CompletedBatchResult;
    terminalState: 'completed' | 'cancelled' | 'failed';
    evidence: 'none' | 'verified-command-receipt';
};

const trackedLeaseSettlementCases = {
    'idempotent-replay': {
        status: 'idempotent-replay',
        createBatchResult: createIdempotentReplayBatchResult,
        terminalState: 'completed',
        evidence: 'verified-command-receipt',
    },
    committed: {
        status: 'committed',
        createBatchResult: createCommittedBatchResult,
        terminalState: 'completed',
        evidence: 'verified-command-receipt',
    },
    'committed-with-warning': {
        status: 'committed-with-warning',
        createBatchResult: createCommittedWithWarningBatchResult,
        terminalState: 'completed',
        evidence: 'verified-command-receipt',
    },
    executed: {
        status: 'executed',
        createBatchResult: createExecutedBatchResult,
        terminalState: 'completed',
        evidence: 'verified-command-receipt',
    },
    'executed-with-warning': {
        status: 'executed-with-warning',
        createBatchResult: createExecutedWithWarningBatchResult,
        terminalState: 'completed',
        evidence: 'verified-command-receipt',
    },
    'no-op': {
        status: 'no-op',
        createBatchResult: createNoOpBatchResult,
        terminalState: 'completed',
        evidence: 'none',
    },
    ambiguous: {
        status: 'ambiguous',
        createBatchResult: createAmbiguousBatchResult,
        terminalState: 'failed',
        evidence: 'none',
    },
    failed: {
        status: 'failed',
        createBatchResult: createFailedBatchResult,
        terminalState: 'failed',
        evidence: 'none',
    },
    conflicted: {
        status: 'conflicted',
        createBatchResult: createConflictedBatchResult,
        terminalState: 'failed',
        evidence: 'none',
    },
    rejected: {
        status: 'rejected',
        createBatchResult: createRejectedBatchResult,
        terminalState: 'failed',
        evidence: 'none',
    },
    cancelled: {
        status: 'cancelled',
        createBatchResult: createCancelledBatchResult,
        terminalState: 'cancelled',
        evidence: 'none',
    },
} satisfies Record<CompletedBatchResult['status'], LeaseSettlementCase>;

function createInput(
    executionFlight: Input['executionFlight'],
    input: {
        confirmation?: ReadyAdmission['confirmation'];
        trackedWorkLease?: NonNullable<ReadyAdmission['trackedWorkLease']>;
        priorVerifiedBatchReceipt?: NonNullable<ReadyAdmission['priorVerifiedBatchReceipt']>;
        recoveringPendingEffects?: boolean;
    } = {}
): Input {
    return {
        executionAdmission: {
            status: 'ready',
            confirmation: input.confirmation ?? confirmation,
            commandBatch,
            approvedBatchId: 'batch-1',
            trackedWorkLease: input.trackedWorkLease ?? null,
            commandBudget: null,
            priorVerifiedBatchReceipt: input.priorVerifiedBatchReceipt ?? null,
            recoveringPendingEffects: input.recoveringPendingEffects ?? false,
        } satisfies ReadyAdmission,
        executionFlight,
    } satisfies Input;
}

function createCompletedFlight(
    batchResult: CompletedBatchResult,
    input: {
        committedProjectRevision?: string | null;
        finalizationEvidenceFailure?: string | null;
        abortSignal?: AbortSignal;
        cancellationTriggeredByInvalidation?: boolean;
        isProjectMutationAuthorized?: () => boolean;
    } = {}
): CompletedFlight {
    return {
        status: 'completed',
        batchResult,
        group: { groupId: 'batch-1', groupLabel: 'Batch' },
        committedProjectRevision:
            input.committedProjectRevision === undefined ? 'revision-1' : input.committedProjectRevision,
        finalizationEvidenceFailure: input.finalizationEvidenceFailure ?? null,
        canRebindSectionRenderArtifacts: true,
        isProjectMutationAuthorized: input.isProjectMutationAuthorized ?? (() => true),
        renderJobAttempts: 0,
        cancellationTriggeredByInvalidation: input.cancellationTriggeredByInvalidation ?? false,
        abortSignal: input.abortSignal ?? new AbortController().signal,
    } satisfies CompletedFlight;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.settleLease.mockReturnValue({ accepted: true, warning: null });
});

describe('settleConfirmedCommandExecution', () => {
    it('records a failed execution flight before releasing confirmation resources', async () => {
        const resourceCleanup = createDeferred<void>();
        mocks.settleResources.mockImplementationOnce(() => resourceCleanup.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput({ status: 'failed', error: new Error('flight failed') })
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, {
            category: 'internal',
            retriable: false,
            knownDomain: false,
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });

        resourceCleanup.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({ status: 'failed', reason: 'flight failed' });
        await settlement.completion;
    });

    it('preserves stale-lease failed-flight cleanup without recording a second failure', async () => {
        mocks.settleLease.mockReturnValueOnce({ accepted: false, warning: 'work lease was replaced' });

        const result = await settleConfirmedCommandExecution(
            createInput({ status: 'failed', error: new Error('flight failed') }, { trackedWorkLease })
        );

        expect(result).toEqual({ status: 'failed', reason: 'flight failed' });
        expect(mocks.recordFailure).not.toHaveBeenCalled();
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'flight failed work lease was replaced',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: 'flight failed work lease was replaced',
            content: 'Failed to execute confirmed actions atomically:\n\nflight failed work lease was replaced',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });

    it.each([
        ['rejected', createRejectedBatchResult],
        ['conflicted', createConflictedBatchResult],
        ['failed', createFailedBatchResult],
    ] as const)('invalidates an unauthorized pre-commit %s result', async (status, createBatchResult) => {
        const batchResult = createBatchResult();
        const result = await settleConfirmedCommandExecution(
            createInput(
                createCompletedFlight(batchResult, {
                    isProjectMutationAuthorized: () => false,
                })
            )
        );

        expect(batchResult.status).toBe(status);
        expect(result).toEqual({ status: 'invalidated', reason: 'project changed' });
        expect(mocks.invalidate).toHaveBeenCalledWith(confirmation);
        expect(mocks.recordFailure).not.toHaveBeenCalled();
        expect(mocks.settleResources).not.toHaveBeenCalled();
    });

    it('settles a recovering pre-commit failure without invalidating for authorization drift', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(
                createCompletedFlight(createFailedBatchResult(), {
                    isProjectMutationAuthorized: () => false,
                }),
                { recoveringPendingEffects: true }
            )
        );

        expect(result).toEqual({ status: 'failed', reason: 'precondition failed' });
        expect(mocks.invalidate).not.toHaveBeenCalled();
        expect(mocks.recordFailure).toHaveBeenCalledWith(
            confirmation,
            expect.objectContaining({ category: 'project' })
        );
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });

    it('retains a committed change when finalization evidence is absent', async () => {
        const batchResult = createCommittedBatchResult();
        const resourceRetention = createDeferred<void>();
        mocks.retainResources.mockImplementationOnce(() => resourceRetention.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput(
                createCompletedFlight(batchResult, {
                    committedProjectRevision: 'revision-2',
                    finalizationEvidenceFailure: 'finalization evidence is unavailable',
                })
            )
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.recordCommittedRecoveryFailure).toHaveBeenCalledWith(confirmation, {
            category: 'internal',
            retriable: false,
            receipt: batchResult.receipt,
            actions: confirmation.actions,
            commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');

        resourceRetention.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            reason: 'finalization evidence is unavailable',
        });
        await settlement.completion;
        expect(mocks.createFinalizationFailure).toHaveBeenCalledWith('finalization evidence is unavailable');
    });

    it('awaits retention for a stale lease after finalization evidence is unavailable', async () => {
        const batchResult = createCommittedBatchResult();
        const resourceRetention = createDeferred<void>();
        mocks.settleLease.mockReturnValueOnce({ accepted: false, warning: 'work lease was replaced' });
        mocks.retainResources.mockImplementationOnce(() => resourceRetention.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput(
                createCompletedFlight(batchResult, {
                    committedProjectRevision: 'revision-2',
                    finalizationEvidenceFailure: 'finalization evidence is unavailable',
                }),
                { trackedWorkLease }
            )
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');

        resourceRetention.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            reason: 'finalization evidence is unavailable work lease was replaced',
        });
        await settlement.completion;
    });

    it('awaits retention for an ambiguous pending-effect recovery', async () => {
        const priorVerifiedBatchReceipt = createCommittedBatchResult().receipt;
        const resourceRetention = createDeferred<void>();
        mocks.retainResources.mockImplementationOnce(() => resourceRetention.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createAmbiguousBatchResult()), {
                recoveringPendingEffects: true,
                priorVerifiedBatchReceipt,
            })
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');

        resourceRetention.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            receipt: priorVerifiedBatchReceipt,
            reason: 'partial write',
        });
        await settlement.completion;
    });

    it('awaits retention for a failed pending-effect recovery', async () => {
        const priorVerifiedBatchReceipt = createCommittedBatchResult().receipt;
        const resourceRetention = createDeferred<void>();
        mocks.retainResources.mockImplementationOnce(() => resourceRetention.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createFailedBatchResult()), {
                recoveringPendingEffects: true,
                priorVerifiedBatchReceipt,
            })
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');

        resourceRetention.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            receipt: priorVerifiedBatchReceipt,
            reason: 'precondition failed',
        });
        await settlement.completion;
    });

    it('delegates idempotent replay to verified replay settlement', async () => {
        const batchResult = createIdempotentReplayBatchResult();
        const replayConfirmation = {
            ...confirmation,
            groupId: 'confirmation-group-2',
        } satisfies PendingAppActionConfirmation;
        await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(batchResult), { confirmation: replayConfirmation })
        );

        expect(mocks.settleReplay).toHaveBeenCalledWith({
            confirmation: replayConfirmation,
            approvedBatchId: 'batch-1',
            receipt: batchResult.receipt,
            recoveredExternalEffects: false,
            leaseSettlement: { accepted: true, warning: null },
        });
    });

    it('cancels a user-aborted confirmed batch without invalidating the proposal', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createCancelledBatchResult(), { abortSignal: controller.signal }))
        );

        expect(result).toEqual({ status: 'cancelled' });
        expect(mocks.cancel).toHaveBeenCalled();
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('awaits no-op resource cleanup before reporting completion', async () => {
        const resourceCleanup = createDeferred<void>();
        mocks.settleResources.mockImplementationOnce(() => resourceCleanup.promise);
        let settled = false;
        const resultPromise = settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createNoOpBatchResult()))
        );
        const settlement = resultPromise.then(() => {
            settled = true;
        });

        await Promise.resolve();

        expect(settled).toBe(false);
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.message).not.toHaveBeenCalled();
        expect(mocks.completeNoOp).toHaveBeenCalledWith(confirmation, undefined);
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });

        resourceCleanup.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({ status: 'executed' });
        await settlement;

        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'executed',
        });
    });

    it('awaits stale no-op resource cleanup before reporting cancellation', async () => {
        const resourceCleanup = createDeferred<void>();
        mocks.settleLease.mockReturnValueOnce({ accepted: false, warning: 'work lease was replaced' });
        mocks.settleResources.mockImplementationOnce(() => resourceCleanup.promise);
        let settled = false;
        const resultPromise = settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createNoOpBatchResult()), { trackedWorkLease })
        );
        const settlement = resultPromise.then(() => {
            settled = true;
        });

        await Promise.resolve();

        expect(settled).toBe(false);
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.message).not.toHaveBeenCalled();
        expect(mocks.completeNoOp).not.toHaveBeenCalled();
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });

        resourceCleanup.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
        await settlement;

        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'cancelled',
            error: 'work lease was replaced',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'cancelled',
            error: 'work lease was replaced',
            content:
                'No project changes were needed after confirmation, but the run was already cancelled or replaced. work lease was replaced',
        });
    });

    it('retains resources after an ambiguous batch outcome', async () => {
        const resourceCleanup = createDeferred<void>();
        mocks.settleResources.mockImplementationOnce(() => resourceCleanup.promise);
        const resultPromise = settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createAmbiguousBatchResult()))
        );
        const settlement = observeSettlement(resultPromise);

        await Promise.resolve();

        expect(settlement.isSettled()).toBe(false);
        expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, {
            category: 'conflict',
            retriable: false,
            compensation: 'manual-repair',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', disposition: 'retain' });

        resourceCleanup.resolve(undefined);

        await expect(resultPromise).resolves.toEqual({ status: 'failed', reason: 'partial write' });
        await settlement.completion;
    });

    it('delegates committed batches to committed outcome settlement', async () => {
        await settleConfirmedCommandExecution(createInput(createCompletedFlight(createCommittedBatchResult())));

        expect(mocks.settleBatchOutcome).toHaveBeenCalledWith(
            expect.objectContaining({ batchResult: expect.objectContaining({ status: 'committed' }) })
        );
    });

    it('delegates committed batches with warnings to committed outcome settlement', async () => {
        await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createCommittedWithWarningBatchResult()))
        );

        expect(mocks.settleBatchOutcome).toHaveBeenCalledWith(
            expect.objectContaining({ batchResult: expect.objectContaining({ status: 'committed-with-warning' }) })
        );
    });

    it.each(Object.values(trackedLeaseSettlementCases))(
        'settles $status results with the exact work-lease contract',
        async ({ status, createBatchResult, terminalState, evidence }) => {
            const batchResult = createBatchResult();

            await settleConfirmedCommandExecution(
                createInput(createCompletedFlight(batchResult), { trackedWorkLease })
            );

            expect(batchResult.status).toBe(status);
            expect(mocks.settleLease).toHaveBeenCalledWith(
                expect.objectContaining({
                    lease: trackedWorkLease,
                    terminalState,
                    evidence,
                })
            );
        }
    );

    it('forwards the authoritative receipt warning for a warned runtime result', async () => {
        mocks.settleLease.mockReturnValueOnce({ accepted: false, warning: 'authoritative receipt warning' });

        await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createExecutedWithWarningBatchResult()), { trackedWorkLease })
        );

        expect(mocks.settleBatchOutcome).toHaveBeenCalledWith(
            expect.objectContaining({
                trackedLeaseSettlement: { accepted: false, warning: 'authoritative receipt warning' },
            })
        );
    });

    it.each([
        ['failed', 'project', createFailedBatchResult],
        ['conflicted', 'conflict', createConflictedBatchResult],
        ['rejected', 'authorization', createRejectedBatchResult],
    ] as const)(
        'records %s completed results with the %s failure category',
        async (_status, category, createBatchResult) => {
            const resourceCleanup = createDeferred<void>();
            mocks.settleResources.mockImplementationOnce(() => resourceCleanup.promise);
            const resultPromise = settleConfirmedCommandExecution(
                createInput(createCompletedFlight(createBatchResult()))
            );
            const settlement = observeSettlement(resultPromise);

            await Promise.resolve();

            expect(settlement.isSettled()).toBe(false);
            expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, {
                category,
                retriable: false,
            });
            expect(mocks.settleResources).toHaveBeenCalledWith({
                confirmationId: 'confirmation-1',
                disposition: 'discard',
            });

            resourceCleanup.resolve(undefined);

            await expect(resultPromise).resolves.toEqual({ status: 'failed', reason: 'precondition failed' });
            await settlement.completion;
        }
    );

    it('records proposal invalidation as a known domain conflict', async () => {
        await settleConfirmedCommandExecution(
            createInput({ status: 'failed', error: new AiProposalInvalidatedError('proposal invalidated') })
        );

        expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, {
            category: 'conflict',
            retriable: false,
            knownDomain: true,
        });
    });
});
