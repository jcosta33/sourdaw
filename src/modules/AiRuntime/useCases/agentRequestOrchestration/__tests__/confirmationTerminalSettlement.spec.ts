import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { confirmationTerminalSettlement } from '../confirmationTerminalSettlement';

const mocks = vi.hoisted(() => ({
    cancelBeforeCommit: vi.fn(),
    cancelRun: vi.fn(),
    message: vi.fn(),
    recordFailure: vi.fn(),
    settleResources: vi.fn(),
    status: vi.fn(),
    followUp: vi.fn(),
}));

vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.message }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    updatePendingActionConfirmationStatus: mocks.status,
    updatePendingActionFollowUp: mocks.followUp,
}));
vi.mock('../../cancelAgentRun', () => ({ agentRunCancellation: { cancel: mocks.cancelRun } }));
vi.mock('../agentRunExecutionSettlement', () => ({
    agentRunExecutionSettlement: {
        cancelBeforeCommit: mocks.cancelBeforeCommit,
        recordFailure: mocks.recordFailure,
    },
}));
vi.mock('../pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: { settleBestEffort: mocks.settleResources },
}));

type AddDeviceAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'addDevice' }>;

const action = {
    type: 'addDevice',
    payload: { trackId: 'track-a', deviceType: 'builtin-compressor', deviceId: 'device-a' },
} satisfies AddDeviceAction;

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
    approvalSnapshot: { actions: [action], actionLabels: ['Add compressor'], protectedUnchanged: [] },
    executionMode: 'atomic',
    groupId: 'group-1',
} satisfies PendingAppActionConfirmation;

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const promise = new Promise<void>((resolve) => {
        deferred.resolve = () => resolve();
    });
    return {
        promise,
        resolve: () => {
            const resolveDeferred = deferred.resolve;
            if (!resolveDeferred) {
                throw new Error('Deferred resolver was not initialized.');
            }
            resolveDeferred();
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('confirmationTerminalSettlement', () => {
    it('fails a render retry proof without replaying project actions', () => {
        expect(confirmationTerminalSettlement.failSectionRenderRetryProof(confirmation)).toEqual({
            status: 'failed',
            reason: 'The retained render retry proof no longer matches the committed project batch.',
        });
        expect(mocks.followUp).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'The retained render retry proof no longer matches the committed project batch.',
        });
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'The retained render retry proof no longer matches the committed project batch.',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            pendingActionFollowUpStatus: 'failed',
            error: 'The retained render retry proof no longer matches the committed project batch.',
            content:
                'The missing section renders were not retried because the retained proof no longer matches the approved batch and recorded commit evidence. Project actions were not replayed. Verify the project state before taking further action.',
        });
    });

    it.each([
        [
            true,
            'The durable commit evidence for the retained render retry could not be read: unavailable. The render retry remains available.',
            'The missing section renders were not retried because the durable commit evidence could not be read: unavailable. Project actions were not replayed and the render retry remains available.',
        ],
        [
            false,
            'The durable commit evidence for the confirmed actions could not be read: unavailable. The proposal remains pending.',
            'The confirmed actions were not executed because the durable commit evidence could not be read: unavailable. Project actions were not replayed; the proposal remains pending.',
        ],
    ])('reports unreadable commit evidence with retry availability %s', (retryRemainsAvailable, reason, content) => {
        expect(
            confirmationTerminalSettlement.failUnreadableCommitEvidence(
                confirmation,
                new Error('unavailable'),
                retryRemainsAvailable
            )
        ).toEqual({ status: 'failed', reason });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', { error: reason, content });
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.followUp).not.toHaveBeenCalled();
    });

    it('records a preflight failure before awaiting resource discard', async () => {
        const discard = createDeferred();
        mocks.settleResources.mockReturnValueOnce(discard.promise);
        let settled = false;
        const result = confirmationTerminalSettlement
            .failApprovalPreflight(confirmation, 'budget exceeded', 'budget')
            .then((value) => {
                settled = true;
                return value;
            });

        expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, { category: 'budget', retriable: true });
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'budget exceeded',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: 'budget exceeded',
            content: 'The confirmed command was rejected before execution: budget exceeded',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
        expect(settled).toBe(false);

        discard.resolve();
        await expect(result).resolves.toEqual({ status: 'failed', reason: 'budget exceeded' });
    });

    it('awaits run cancellation before invalidating an ordinarily stale proposal', async () => {
        const cancellation = createDeferred();
        const discard = createDeferred();
        mocks.cancelRun.mockReturnValueOnce(cancellation.promise);
        mocks.settleResources.mockReturnValueOnce(discard.promise);
        let settled = false;
        const result = confirmationTerminalSettlement.invalidateForProjectChange(confirmation).then((value) => {
            settled = true;
            return value;
        });

        expect(mocks.cancelRun).toHaveBeenCalledWith({
            runId: 'run-1',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.message).not.toHaveBeenCalled();
        expect(mocks.settleResources).not.toHaveBeenCalled();
        expect(settled).toBe(false);

        cancellation.resolve();
        await Promise.resolve();
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'invalidated',
            error: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'invalidated',
            error: 'The project changed after this proposal was created. Review and submit the command again.',
            content:
                'This proposal was not executed because the project changed after it was created. Review the current project and submit the command again.',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
        expect(settled).toBe(false);

        discard.resolve();
        await expect(result).resolves.toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
    });

    it('awaits cancellation and resource discard before invalidating a divergent proposal', async () => {
        const divergence = {
            kind: 'ambiguous-same-object',
            mayReapply: false,
            targetIds: ['track-a'],
            repairCandidates: [{ kind: 'review-ambiguous-target', targetIds: ['track-b'] }],
        } as const;
        const cancellation = createDeferred();
        const discard = createDeferred();
        mocks.cancelRun.mockReturnValueOnce(cancellation.promise);
        mocks.settleResources.mockReturnValueOnce(discard.promise);
        let settled = false;
        const result = confirmationTerminalSettlement
            .invalidateForDivergence(confirmation, divergence)
            .then((value) => {
                settled = true;
                return value;
            });

        expect(mocks.cancelRun).toHaveBeenCalledWith({
            runId: 'run-1',
            reason: 'The approved command was not executed because project divergence is ambiguous-same-object.',
        });
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.message).not.toHaveBeenCalled();
        expect(mocks.settleResources).not.toHaveBeenCalled();
        expect(settled).toBe(false);

        cancellation.resolve();
        await Promise.resolve();
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'invalidated',
            error: 'The approved command was not executed because project divergence is ambiguous-same-object.',
        });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'invalidated',
            error: 'The approved command was not executed because project divergence is ambiguous-same-object.',
            content:
                'The approved command was not executed because project divergence is ambiguous-same-object. Affected targets: track-a. Repair candidates: review-ambiguous-target: track-b. Review the current project before planning again.',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
        expect(settled).toBe(false);

        discard.resolve();
        await expect(result).resolves.toEqual({
            status: 'invalidated',
            reason: 'The approved command was not executed because project divergence is ambiguous-same-object.',
            divergence,
        });
    });

    it('formats empty divergence targets and candidate targets as project guidance', async () => {
        const divergence = {
            kind: 'deleted-target',
            mayReapply: false,
            targetIds: [],
            repairCandidates: [{ kind: 'replan-without-deleted-target', targetIds: [] }],
        } as const;

        await expect(confirmationTerminalSettlement.invalidateForDivergence(confirmation, divergence)).resolves.toEqual(
            {
                status: 'invalidated',
                reason: 'The approved command was not executed because project divergence is deleted-target.',
                divergence,
            }
        );
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'invalidated',
            error: 'The approved command was not executed because project divergence is deleted-target.',
            content:
                'The approved command was not executed because project divergence is deleted-target. Affected targets: none. Repair candidates: replan-without-deleted-target: project. Review the current project before planning again.',
        });
    });

    it('cancels an accepted confirmation before awaiting resource discard', async () => {
        const discard = createDeferred();
        mocks.settleResources.mockReturnValueOnce(discard.promise);
        let settled = false;
        const result = confirmationTerminalSettlement.cancelAcceptedConfirmation(confirmation).then((value) => {
            settled = true;
            return value;
        });

        expect(mocks.cancelBeforeCommit).toHaveBeenCalledWith(confirmation);
        expect(mocks.status).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', status: 'cancelled' });
        expect(mocks.message).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'cancelled',
            error: undefined,
            content: 'Command cancelled before it committed. No project changes were applied.',
        });
        expect(mocks.settleResources).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            disposition: 'discard',
        });
        expect(settled).toBe(false);

        discard.resolve();
        await expect(result).resolves.toEqual({ status: 'cancelled' });
    });
});
