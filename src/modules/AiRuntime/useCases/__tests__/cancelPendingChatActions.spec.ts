import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cancelAgentRun: vi.fn(),
    getPendingActionConfirmation: vi.fn(),
    settlePendingActionResourceLease: vi.fn(),
    updatePendingActionConfirmationStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('../cancelAgentRun', () => ({
    agentRunCancellation: { cancel: mocks.cancelAgentRun },
}));

vi.mock('../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getPendingActionConfirmation,
    settlePendingActionResourceLease: mocks.settlePendingActionResourceLease,
    updatePendingActionConfirmationStatus: mocks.updatePendingActionConfirmationStatus,
}));

vi.mock('../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

import { cancelPendingChatActions } from '../cancelPendingChatActions';

describe('cancelPendingChatActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cancelAgentRun.mockResolvedValue({ status: 'cancelled', phase: 'cancelled' });
    });

    it('returns {status: "missing"} when the confirmation does not exist', async () => {
        mocks.getPendingActionConfirmation.mockReturnValue(null);

        const result = await cancelPendingChatActions({ confirmationId: 'nope' });

        expect(result).toEqual({ status: 'missing' });
        expect(mocks.updatePendingActionConfirmationStatus).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
    });

    it('returns {status: "not_pending"} when the confirmation is not in the proposed state', async () => {
        mocks.getPendingActionConfirmation.mockReturnValue({
            id: 'conf-1',
            status: 'confirmed',
            assistantMessageId: 'msg-1',
            actionLabels: ['Add track'],
        });

        const result = await cancelPendingChatActions({ confirmationId: 'conf-1' });

        expect(result).toEqual({ status: 'not_pending', currentStatus: 'confirmed' });
        expect(mocks.updatePendingActionConfirmationStatus).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
    });

    it('cancels a proposed confirmation through the run controller before releasing retained resources', async () => {
        mocks.getPendingActionConfirmation.mockReturnValue({
            id: 'conf-2',
            status: 'proposed',
            assistantMessageId: 'msg-2',
            actionLabels: ['Add track', 'Set tempo'],
            approvalSnapshot: { actions: [] },
            runId: 'run-conf-2',
        });

        const result = await cancelPendingChatActions({ confirmationId: 'conf-2' });

        expect(result).toEqual({ status: 'cancelled' });
        expect(mocks.cancelAgentRun).toHaveBeenCalledExactlyOnceWith({
            runId: 'run-conf-2',
            reason: 'User cancelled the pending confirmation.',
        });
        expect(mocks.updatePendingActionConfirmationStatus).toHaveBeenCalledWith({
            confirmationId: 'conf-2',
            status: 'cancelled',
        });
        expect(mocks.settlePendingActionResourceLease).toHaveBeenCalledExactlyOnceWith({
            confirmationId: 'conf-2',
            disposition: 'discard',
        });
        expect(mocks.cancelAgentRun.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.settlePendingActionResourceLease.mock.invocationCallOrder[0]!
        );
    });

    it('updates the chat message with a formatted cancellation summary', async () => {
        mocks.getPendingActionConfirmation.mockReturnValue({
            id: 'conf-3',
            status: 'proposed',
            assistantMessageId: 'msg-3',
            actionLabels: ['Add track', 'Set tempo to 120'],
            approvalSnapshot: { actions: [] },
        });

        await cancelPendingChatActions({ confirmationId: 'conf-3' });

        expect(mocks.updateChatMessage).toHaveBeenCalledTimes(1);
        const [messageId, update] = mocks.updateChatMessage.mock.calls[0]!;
        expect(messageId).toBe('msg-3');
        expect(update.pendingActionConfirmationStatus).toBe('cancelled');
        // The content lists each action label as a bullet point.
        expect(update.content).toContain('- Add track');
        expect(update.content).toContain('- Set tempo to 120');
        expect(update.content).toContain('Cancelled pending actions:');
    });

    it('handles a single action label in the cancellation message', async () => {
        mocks.getPendingActionConfirmation.mockReturnValue({
            id: 'conf-4',
            status: 'proposed',
            assistantMessageId: 'msg-4',
            actionLabels: ['Solo track 1'],
            approvalSnapshot: { actions: [] },
        });

        await cancelPendingChatActions({ confirmationId: 'conf-4' });

        const update = mocks.updateChatMessage.mock.calls[0]?.[1];
        expect(update.content).toBe('Cancelled pending actions:\n\n- Solo track 1');
    });
});
