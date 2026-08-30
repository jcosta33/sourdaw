import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('#/modules/Command/useCases', () => ({
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

const receipt = {
    batchId: 'batch-1',
    schemaVersion: 1,
    runId: 'run-1',
    outcome: 'committed',
    pendingEffects: [],
};

function createInput(executionFlight: Input['executionFlight']): Input {
    return {
        executionAdmission: {
            confirmation: {
                id: 'confirmation-1',
                runId: 'run-1',
                assistantMessageId: 'assistant-1',
                projectRevision: 'revision-1',
                actions: [],
                approvalSnapshot: { actions: [] },
            },
            commandBatch: { serialized: 'serialized', authority: 'authority' },
            approvedBatchId: 'batch-1',
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        } as Input['executionAdmission'],
        executionFlight,
    };
}

function completedFlight(batchResult: object, overrides: object = {}): Input['executionFlight'] {
    return {
        status: 'completed',
        batchResult,
        group: { groupId: 'batch-1', groupLabel: 'Batch' },
        committedProjectRevision: 'revision-1',
        finalizationEvidenceFailure: null,
        canRebindSectionRenderArtifacts: true,
        isProjectMutationAuthorized: () => true,
        renderJobAttempts: 0,
        cancellationTriggeredByInvalidation: false,
        abortSignal: new AbortController().signal,
        ...overrides,
    } as Input['executionFlight'];
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
        expect(mocks.recordFailure).toHaveBeenCalled();
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });

    it('retains a committed change when finalization evidence is absent', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(completedFlight({ status: 'committed', receipt }, { committedProjectRevision: null }))
        );

        expect(result).toEqual({ status: 'failed', durableCommit: true, reason: expect.any(String) });
        expect(mocks.createFinalizationFailure).toHaveBeenCalled();
        expect(mocks.retainResources).toHaveBeenCalledWith('confirmation-1');
    });

    it('delegates idempotent replay to verified replay settlement', async () => {
        await settleConfirmedCommandExecution(createInput(completedFlight({ status: 'idempotent-replay', receipt })));

        expect(mocks.settleReplay).toHaveBeenCalledWith(expect.objectContaining({ receipt }));
    });

    it('cancels a user-aborted confirmed batch without invalidating the proposal', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await settleConfirmedCommandExecution(
            createInput(completedFlight({ status: 'cancelled', receipt }, { abortSignal: controller.signal }))
        );

        expect(result).toEqual({ status: 'cancelled' });
        expect(mocks.cancel).toHaveBeenCalled();
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('completes a no-op batch and discards temporary resources', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(completedFlight({ status: 'no-op', receipt }))
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
            createInput(completedFlight({ status: 'ambiguous', reason: 'partial write', receipt }))
        );

        expect(result).toEqual({ status: 'failed', reason: 'partial write' });
        expect(mocks.recordFailure).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ category: 'conflict' })
        );
        expect(mocks.settleResources).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', disposition: 'retain' });
    });

    it('delegates committed batches to committed outcome settlement', async () => {
        await settleConfirmedCommandExecution(createInput(completedFlight({ status: 'committed', receipt })));

        expect(mocks.settleBatchOutcome).toHaveBeenCalledWith(
            expect.objectContaining({ batchResult: expect.objectContaining({ status: 'committed' }) })
        );
    });

    it('delegates committed batches with warnings to committed outcome settlement', async () => {
        await settleConfirmedCommandExecution(
            createInput(completedFlight({ status: 'committed-with-warning', receipt, warning: 'effect pending' }))
        );

        expect(mocks.settleBatchOutcome).toHaveBeenCalledWith(
            expect.objectContaining({ batchResult: expect.objectContaining({ status: 'committed-with-warning' }) })
        );
    });

    it('records an ordinary non-committed failure after discarding resources', async () => {
        const result = await settleConfirmedCommandExecution(
            createInput(completedFlight({ status: 'failed', reason: 'precondition failed', receipt }))
        );

        expect(result).toEqual({ status: 'failed', reason: 'precondition failed' });
        expect(mocks.recordFailure).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ category: 'project' })
        );
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
    });
});
