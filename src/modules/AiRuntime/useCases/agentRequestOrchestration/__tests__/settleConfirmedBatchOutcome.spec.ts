import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleConfirmedBatchOutcome } from '../settleConfirmedBatchOutcome';

const mocks = vi.hoisted(() => ({
    admitRetry: vi.fn(() => ({ status: 'rejected' })),
    createFailure: vi.fn((receipt, reason) => ({
        status: 'failed',
        durableCommit: true,
        reason,
        effects: receipt.pendingEffects,
    })),
    formatReview: vi.fn(() => 'render-a (clipped)'),
    getConfirmation: vi.fn(),
    getLabels: vi.fn(() => new Map()),
    getAffectedIds: vi.fn(() => ['track-a']),
    loggerError: vi.fn(),
    notify: vi.fn(),
    project: vi.fn(),
    pushHistory: vi.fn(),
    recordExecution: vi.fn(),
    recordReceipt: vi.fn(() => ({ warning: null, effectsPending: false })),
    requireManualRepair: vi.fn(() => null),
    updateConfirmation: vi.fn(),
    updateFollowUp: vi.fn(),
    updateMessage: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('../../../stores/aiActionHistoryStore', () => ({ pushAiActionGroup: mocks.pushHistory }));
vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.updateMessage }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getConfirmation,
    recordPendingActionExecution: mocks.recordExecution,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
    updatePendingActionFollowUp: mocks.updateFollowUp,
}));
vi.mock('../../getPlannedActionAffectedIds', () => ({ getPlannedActionAffectedIds: mocks.getAffectedIds }));
vi.mock('../../notifyAiChange', () => ({ notifyAiChange: mocks.notify }));
vi.mock('../admitCommittedSectionRenderRetry', () => ({ admitCommittedSectionRenderRetry: mocks.admitRetry }));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: mocks.createFailure,
        getApprovalLabelsByCommandId: mocks.getLabels,
        recordTrackedAgentRunReceipt: mocks.recordReceipt,
    },
}));
vi.mock('../formatSectionRenderReviewSummary', () => ({ formatSectionRenderReviewSummary: mocks.formatReview }));
vi.mock('../projectSectionRenderConfirmation', () => ({ projectSectionRenderConfirmation: mocks.project }));
vi.mock('../requireSectionRenderManualRepair', () => ({ requireSectionRenderManualRepair: mocks.requireManualRepair }));

type Input = Parameters<typeof settleConfirmedBatchOutcome>[0];

function createInput(status: Input['batchResult']['status']): Input {
    return {
        confirmation: {
            id: 'confirmation-1',
            runId: 'run-1',
            prompt: 'Add an effect',
            assistantMessageId: 'assistant-1',
            approvalSnapshot: { actionLabels: ['Approved effect'] },
        },
        batchResult: {
            status,
            warning: status.endsWith('warning') ? 'follow-up warning' : undefined,
            actions: [{ action: { type: 'addDevice' }, label: 'Generated effect' }],
            receipt: {
                batchId: 'batch-1',
                outcome: 'committed',
                warnings: [],
                modelSummary: 'Committed.',
                pendingEffects: [],
            },
        },
        groupId: 'group-1',
        committedProjectRevision: 'revision-1',
        trackedLeaseSettlement: { accepted: true, warning: null },
        budgetPersistenceWarning: null,
        canRebindSectionRenderArtifacts: true,
        retainCommittedPendingActionResources: vi.fn(),
    } as Input;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockImplementation(({ executions }) => ({
        executions: executions ?? [],
        receipt: 'receipt',
        incompleteSectionRenders: null,
        reviewRequiredSectionRenders: [],
    }));
    mocks.getConfirmation.mockReturnValue(undefined);
    mocks.recordReceipt.mockReturnValue({ warning: null, effectsPending: false });
    mocks.admitRetry.mockReturnValue({ status: 'rejected' });
    mocks.requireManualRepair.mockReturnValue(null);
});

describe('settleConfirmedBatchOutcome', () => {
    it.each([
        ['committed', 'project', undefined],
        ['committed-with-warning', 'project', 'follow-up warning'],
        ['executed', 'runtime', undefined],
        ['executed-with-warning', 'runtime', 'follow-up warning'],
    ] as const)('preserves %s execution kind and warning reporting', async (status, executionKind, warning) => {
        const input = createInput(status);
        const retainResources = vi.fn();
        input.retainCommittedPendingActionResources = retainResources;

        await expect(settleConfirmedBatchOutcome(input)).resolves.toEqual({ status: 'executed' });

        expect(mocks.recordReceipt).toHaveBeenCalledWith(
            input.confirmation,
            input.batchResult.receipt,
            expect.objectContaining({
                completesRun: true,
                committedRevision: 'revision-1',
                ...(executionKind === 'project' ? { revertGroupId: 'group-1' } : {}),
            })
        );
        expect(mocks.recordExecution).toHaveBeenCalledWith(
            expect.objectContaining({
                execution: expect.objectContaining({ executionKind, outcome: status, label: 'Approved effect' }),
            })
        );
        expect(mocks.pushHistory).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'group-1',
                groupId: 'group-1',
                prompt: 'Add an effect',
                executionKind,
                actions: [
                    expect.objectContaining({
                        kind: 'appAction',
                        actionType: 'addDevice',
                        label: 'Approved effect',
                    }),
                ],
            })
        );
        expect(mocks.notify).toHaveBeenCalledWith('Confirmed: Add an effect', ['addDevice']);
        expect(mocks.updateConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'executed', ...(warning ? { error: warning } : {}) })
        );
        expect(mocks.updateMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({ ...(warning ? { error: warning } : {}) })
        );
        expect(mocks.recordReceipt.mock.invocationCallOrder[0]).toBeLessThan(
            retainResources.mock.invocationCallOrder[0]
        );
    });

    it('returns a durable failure while retaining a committed pending effect', async () => {
        const input = createInput('committed-with-warning');
        input.batchResult.receipt = {
            ...input.batchResult.receipt,
            outcome: 'partially-committed',
            warnings: ['render still pending'],
            pendingEffects: [{ remediation: 'manual-repair' }],
        };
        mocks.recordReceipt.mockReturnValue({ warning: null, effectsPending: true });

        await expect(settleConfirmedBatchOutcome(input)).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            reason: 'render still pending',
        });

        expect(input.retainCommittedPendingActionResources).toHaveBeenCalledWith('confirmation-1');
        expect(mocks.updateConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', error: 'follow-up warning' })
        );
        expect(mocks.createFailure).toHaveBeenCalledWith(input.batchResult.receipt, 'render still pending');
        expect(mocks.notify).toHaveBeenCalledWith('Committed with pending external effects: Add an effect', [
            'addDevice',
        ]);
    });

    it('arms a retry only for incomplete warned project renders', async () => {
        const input = createInput('committed-with-warning');
        mocks.project.mockReturnValueOnce({ executions: [], receipt: 'receipt' }).mockReturnValueOnce({
            incompleteSectionRenders: { jobs: [{ jobId: 'render-a' }] },
            reviewRequiredSectionRenders: [],
        });
        mocks.admitRetry.mockReturnValue({ status: 'admitted' });

        await settleConfirmedBatchOutcome(input);

        expect(mocks.updateFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'retryable', projectRevision: 'revision-1' })
        );
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
    });

    it('uses manual repair when retry proof cannot safely follow the committed revision', async () => {
        const input = createInput('committed-with-warning');
        input.canRebindSectionRenderArtifacts = false;
        mocks.project.mockReturnValueOnce({ executions: [], receipt: 'receipt' }).mockReturnValueOnce({
            incompleteSectionRenders: { jobs: [{ jobId: 'render-a' }] },
            reviewRequiredSectionRenders: [],
        });

        await settleConfirmedBatchOutcome(input);

        expect(mocks.requireManualRepair).toHaveBeenCalledWith(
            expect.objectContaining({ batchId: 'batch-1', reason: expect.stringContaining('cannot be retried safely') })
        );
        expect(mocks.updateFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', projectRevision: null })
        );
    });

    it('reports the durable outcome if execution reporting throws', async () => {
        const input = createInput('executed');
        mocks.recordExecution.mockImplementation(() => {
            throw new Error('history unavailable');
        });

        await expect(settleConfirmedBatchOutcome(input)).resolves.toEqual({ status: 'executed' });

        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Confirmed AI action reporting failed after execution' })
        );
        expect(mocks.updateMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                content: expect.stringContaining('runtime command executed, but reporting it failed'),
            })
        );
    });
});
