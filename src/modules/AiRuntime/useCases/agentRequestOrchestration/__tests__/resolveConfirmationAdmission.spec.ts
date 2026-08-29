import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { confirmationAdmission } from '../resolveConfirmationAdmission';

const mocks = vi.hoisted(() => ({
    admitRetry: vi.fn(() => ({ status: 'not-applicable' })),
    chat: vi.fn(),
    getConfirmation: vi.fn(),
    invalidate: vi.fn(async () => ({ status: 'invalidated', reason: 'stale' })),
    revision: vi.fn(() => 'revision-1'),
}));

vi.mock('../../../stores/chatStore', () => ({ chatStore: { value: null }, updateChatMessage: mocks.chat }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getConfirmation,
    refreshPendingActionConfirmationApproval: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRevision: mocks.revision }));
vi.mock('../admitCommittedSectionRenderRetry', () => ({ admitCommittedSectionRenderRetry: mocks.admitRetry }));
vi.mock('../confirmationTerminalSettlement', () => ({
    confirmationTerminalSettlement: {
        failSectionRenderRetryProof: vi.fn(),
        failUnreadableCommitEvidence: vi.fn(),
        invalidateForDivergence: vi.fn(),
        invalidateForProjectChange: mocks.invalidate,
    },
}));

type AddDeviceAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'addDevice' }>;

const action = {
    type: 'addDevice',
    payload: { trackId: 'track-a', deviceType: 'builtin-compressor', deviceId: 'device-a' },
} satisfies AddDeviceAction;

function createConfirmation(status: PendingAppActionConfirmation['status'] = 'proposed'): PendingAppActionConfirmation {
    return {
        id: 'confirmation-1',
        runId: 'run-1',
        prompt: 'Add an effect',
        assistantMessageId: 'assistant-1',
        actionLabels: ['Add compressor'],
        affectedIds: ['track-a'],
        protectedUnchanged: [],
        risk: null,
        executedActions: [],
        status,
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: 0,
        resolvedAt: null,
        kind: 'app_actions',
        projectRevision: 'revision-1',
        actions: [action],
        approvalSnapshot: { actions: [action], actionLabels: ['Add compressor'], protectedUnchanged: [] },
        executionMode: 'atomic',
        groupId: 'group-1',
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfirmation.mockReturnValue(createConfirmation());
    mocks.revision.mockReturnValue('revision-1');
    mocks.admitRetry.mockReturnValue({ status: 'not-applicable' });
});

describe('resolveConfirmationAdmission', () => {
    it('handles a missing confirmation without entering execution', async () => {
        mocks.getConfirmation.mockReturnValue(null);
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'missing' })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'missing' },
        });
    });

    it('preserves a non-pending status', async () => {
        mocks.getConfirmation.mockReturnValue(createConfirmation('failed'));
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'confirmation-1' })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'not_pending', currentStatus: 'failed' },
        });
    });

    it('returns an ordinary ready decision with recovery facts', async () => {
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'confirmation-1' })
        ).resolves.toMatchObject({
            status: 'ready',
            confirmation: createConfirmation(),
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
    });

    it('invalidates a stale confirmation without an approved command batch', async () => {
        mocks.revision.mockReturnValue('revision-2');
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'confirmation-1' })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'invalidated', reason: 'stale' },
        });
        expect(mocks.invalidate).toHaveBeenCalledWith(createConfirmation());
    });
});
