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
    settleLease: vi.fn(() => ({ accepted: true, warning: null })),
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

function createInput(executionFlight: Input['executionFlight']): Input {
    return {
        executionAdmission: {
            status: 'ready',
            confirmation,
            commandBatch,
            approvedBatchId: 'batch-1',
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        } satisfies ReadyAdmission,
        executionFlight,
    } satisfies Input;
}

function createCompletedFlight(
    batchResult: CompletedBatchResult,
    input: {
        committedProjectRevision?: string | null;
        abortSignal?: AbortSignal;
        cancellationTriggeredByInvalidation?: boolean;
    } = {}
): CompletedFlight {
    return {
        status: 'completed',
        batchResult,
        group: { groupId: 'batch-1', groupLabel: 'Batch' },
        committedProjectRevision:
            input.committedProjectRevision === undefined ? 'revision-1' : input.committedProjectRevision,
        finalizationEvidenceFailure: null,
        canRebindSectionRenderArtifacts: true,
        isProjectMutationAuthorized: () => true,
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
        const result = await settleConfirmedCommandExecution(
            createInput({ status: 'failed', error: new Error('flight failed') })
        );

        expect(result).toEqual({ status: 'failed', reason: 'flight failed' });
        expect(mocks.recordFailure).toHaveBeenCalledWith(
            confirmation,
            expect.objectContaining({ category: 'internal', knownDomain: false })
        );
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });

    it('retains a committed change when finalization evidence is absent', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createCommittedBatchResult(), { committedProjectRevision: null }))
        );

        expect(result).toEqual({ status: 'failed', durableCommit: true, reason: expect.any(String) });
        expect(mocks.createFinalizationFailure).toHaveBeenCalled();
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');
    });

    it('delegates idempotent replay to verified replay settlement', async () => {
        const batchResult = createIdempotentReplayBatchResult();
        await settleConfirmedCommandExecution(createInput(createCompletedFlight(batchResult)));

        expect(mocks.settleReplay).toHaveBeenCalledWith(expect.objectContaining({ receipt: batchResult.receipt }));
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

    it('completes a no-op batch and discards temporary resources', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createNoOpBatchResult()))
        );

        expect(result).toEqual({ status: 'executed' });
        expect(mocks.completeNoOp).toHaveBeenCalled();
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });

    it('retains resources after an ambiguous batch outcome', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(createCompletedFlight(createAmbiguousBatchResult()))
        );

        expect(result).toEqual({ status: 'failed', reason: 'partial write' });
        expect(mocks.recordFailure).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ category: 'conflict' })
        );
        expect(mocks.settleResources).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', disposition: 'retain' });
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

    it.each([
        ['failed', 'project', createFailedBatchResult],
        ['conflicted', 'conflict', createConflictedBatchResult],
        ['rejected', 'authorization', createRejectedBatchResult],
    ] as const)(
        'records %s completed results with the %s failure category',
        async (_status, category, createBatchResult) => {
            const result = await settleConfirmedCommandExecution(
                createInput(createCompletedFlight(createBatchResult()))
            );

            expect(result).toEqual({ status: 'failed', reason: 'precondition failed' });
            expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, expect.objectContaining({ category }));
            expect(mocks.settleResources).toHaveBeenCalledWith({
                confirmationId: 'confirmation-1',
                disposition: 'discard',
            });
        }
    );

    it('records proposal invalidation as a known domain conflict', async () => {
        await settleConfirmedCommandExecution(
            createInput({ status: 'failed', error: new AiProposalInvalidatedError('proposal invalidated') })
        );

        expect(mocks.recordFailure).toHaveBeenCalledWith(
            confirmation,
            expect.objectContaining({ category: 'conflict', knownDomain: true })
        );
    });
});
