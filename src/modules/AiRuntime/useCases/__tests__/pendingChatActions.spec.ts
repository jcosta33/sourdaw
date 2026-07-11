import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type EditPlan } from '../../models/DsoTypes';
import { type RuntimeAction } from '../../models/RuntimeAction';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    proposePendingDsoConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isAppActionCommittedError: vi.fn<(error: unknown) => boolean>(() => false),
    describeAction: vi.fn(() => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    pushAiActionGroup: vi.fn(),
    updateChatMessage: vi.fn(),
    notifyAiChange: vi.fn(),
    commitDsoEditPlan: vi.fn(async () => ({ summaries: ['Removed track'], failures: [] })),
    trackStoreState: {
        value: {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [{ id: 'device-1', name: 'Synth', type: 'builtin-synth' }],
                },
            ],
            selectedTrackId: 'track-1',
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    isAppActionCommittedError: mocks.isAppActionCommittedError,
    describeAction: mocks.describeAction,
    generateGroupId: mocks.generateGroupId,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreState.value;
        },
    },
}));

vi.mock('../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

vi.mock('../dsoEditor/commitDsoEditPlan', () => ({
    commitDsoEditPlan: mocks.commitDsoEditPlan,
}));

const pendingAction: RuntimeAction = { type: 'removeTrack', payload: { trackId: 'track-1' } };
const secondPendingAction: RuntimeAction = { type: 'removeClip', payload: { clipId: 'clip-1' } };
const pendingDsoPlan: EditPlan = {
    kind: 'edit_plan',
    moderation: 'allow',
    intent: 'remove drums',
    dsos: [{ op: 'remove_track', track_id: 'track-1' }],
};

describe('pending chat action confirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPendingActionConfirmations();
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.commitDsoEditPlan.mockResolvedValue({ summaries: ['Removed track'], failures: [] });
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [{ id: 'device-1', name: 'Synth', type: 'builtin-synth' }],
                },
            ],
            selectedTrackId: 'track-1',
        };
    });

    it('should execute a proposed action group only after explicit confirmation', async () => {
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(mocks.executeAppAction).toHaveBeenCalledWith(pendingAction, {
            groupId: 'group-1',
            groupLabel: 'delete drums',
            source: 'prompt',
        });
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith({
            id: 'group-1',
            prompt: 'delete drums',
            actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            groupId: 'group-1',
            timestamp: expect.any(Number),
            reverted: false,
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Confirmed: delete drums', ['removeTrack']);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringContaining('Executed'),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track' },
        ]);
    });

    it('should execute a pending DSO edit through the DSO commit path only after explicit confirmation', async () => {
        proposePendingDsoConfirmation({
            id: 'confirm-dso-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            plan: pendingDsoPlan,
            actionLabels: ['Remove track "Drums"'],
            confirmationTargets: [
                {
                    op: 'remove_track',
                    label: 'Remove track "Drums"',
                    fingerprint: { kind: 'track', trackId: 'track-1', trackName: 'Drums' },
                },
            ],
            reasoning: 'track removal is destructive',
        });

        expect(mocks.commitDsoEditPlan).not.toHaveBeenCalled();

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-dso-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(mocks.commitDsoEditPlan).toHaveBeenCalledWith({
            plan: pendingDsoPlan,
            userRequest: 'delete drums',
            assistantMessageId: 'assistant-1',
            reasoning: 'track removal is destructive',
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Confirmed: delete drums', ['dsoEdit']);
        expect(getPendingActionConfirmation('confirm-dso-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-dso-1')?.executedActions).toEqual([
            { actionType: 'dsoEdit', label: 'Removed track' },
        ]);
    });

    it('should fail safely when a destructive DSO target identity changed before confirmation', async () => {
        proposePendingDsoConfirmation({
            id: 'confirm-dso-stale',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            plan: pendingDsoPlan,
            actionLabels: ['Remove track "Drums"'],
            confirmationTargets: [
                {
                    op: 'remove_track',
                    label: 'Remove track "Drums"',
                    fingerprint: { kind: 'track', trackId: 'track-1', trackName: 'Drums' },
                },
            ],
            reasoning: 'track removal is destructive',
        });
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Percussion',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [{ id: 'device-1', name: 'Synth', type: 'builtin-synth' }],
                },
            ],
            selectedTrackId: 'track-1',
        };

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-dso-stale' });

        expect(result).toEqual({
            status: 'failed',
            reason: 'The destructive edit target changed: Remove track "Drums"',
        });
        expect(mocks.commitDsoEditPlan).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirm-dso-stale')?.status).toBe('failed');
        expect(getPendingActionConfirmation('confirm-dso-stale')?.error).toBe(
            'The destructive edit target changed: Remove track "Drums"'
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringContaining('Project state changed'),
            })
        );
    });

    it('should cancel proposed actions without executing them', () => {
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
        });

        const result = cancelPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'cancelled' });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'cancelled',
                content: expect.stringContaining('Cancelled'),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('cancelled');
    });

    it('should report a missing handler as not executed without dropping the proposal record', async () => {
        const missing_handler = new Error('No handler registered for action: removeClip');
        mocks.executeAppAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(missing_handler);
        mocks.describeAction.mockReturnValueOnce('Remove track');
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason: missing_handler.message });
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Confirmed: delete drums', ['removeTrack']);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: missing_handler.message,
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringMatching(/partially.*do not retry the whole command/is),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('failed');
        expect(getPendingActionConfirmation('confirm-1')?.error).toBe(missing_handler.message);
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track' },
        ]);
    });

    it('should record a committed confirmation action as executed and warn against retrying', async () => {
        const committed_failure = new Error('Action committed but history failed');
        mocks.executeAppAction.mockRejectedValueOnce(committed_failure);
        mocks.isAppActionCommittedError.mockImplementation((error) => error === committed_failure);
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track' },
        ]);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringMatching(/applied.*history.*do not retry/is),
            })
        );
    });
});
