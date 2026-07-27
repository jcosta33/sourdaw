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

type ExecuteAppActionBatch = (typeof import('#/modules/Command/useCases'))['executeAppActionBatch'];
type AppAction = Parameters<ExecuteAppActionBatch>[0][number];

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    executeAppActionBatch: vi.fn<ExecuteAppActionBatch>(),
    describeAction: vi.fn((_action: AppAction) => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    pushAiActionGroup: vi.fn(),
    updateChatMessage: vi.fn(),
    notifyAiChange: vi.fn(),
    commitDsoEditPlan: vi.fn(() => Promise.resolve({ summaries: ['Removed track'], failures: [] })),
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

vi.mock('#/modules/Command/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
    executeAppActionBatch: mocks.executeAppActionBatch,
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
        mocks.executeAppActionBatch.mockImplementation((actions: Parameters<ExecuteAppActionBatch>[0]) =>
            Promise.resolve({
                status: 'committed',
                actions: actions.map((action) => ({
                    action,
                    label: mocks.describeAction(action),
                })),
            })
        );
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
        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith([pendingAction], {
            groupId: 'group-1',
            groupLabel: 'delete drums',
            source: 'prompt',
            requireCompensation: false,
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
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
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
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'rejected',
            reason: missing_handler.message,
            actions: [],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason: missing_handler.message });
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: missing_handler.message,
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringMatching(/failed.*atomically/is),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('failed');
        expect(getPendingActionConfirmation('confirm-1')?.error).toBe(missing_handler.message);
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([]);
    });

    it('should preserve an ambiguous confirmed batch without claiming any action executed', async () => {
        const reason = 'Automerge storage transaction committed before a later document failed';
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'ambiguous',
            reason,
            actions: [],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason });
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([]);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: reason,
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringMatching(/uncertain partial commit.*do not retry/is),
            })
        );
    });

    it('should record a committed confirmation action as executed and warn against retrying', async () => {
        const warning = 'Action committed but history failed';
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed-with-warning',
            actions: [{ action: pendingAction, label: 'Remove track' }],
            warning,
        });
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

    it('keeps a confirmed action executed when AI history reporting throws after commit', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [{ action: pendingAction, label: 'Remove track' }],
        });
        mocks.pushAiActionGroup.mockImplementationOnce(() => {
            throw new Error('AI history unavailable');
        });
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
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                error: 'AI history unavailable',
                content: expect.stringMatching(/project change committed.*do not retry/is),
            })
        );
    });

    it('should execute a multi-action confirmation through one atomic batch', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [
                { action: pendingAction, label: 'Remove track' },
                { action: secondPendingAction, label: 'Remove clip' },
            ],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums and clip',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track' },
            { actionType: 'removeClip', label: 'Remove clip' },
        ]);
        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith([pendingAction, secondPendingAction], {
            groupId: 'group-1',
            groupLabel: 'delete drums',
            source: 'prompt',
            requireCompensation: true,
        });
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [
                    { kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' },
                    { kind: 'appAction', actionType: 'removeClip', label: 'Remove clip' },
                ],
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringMatching(/executed.*remove track.*remove clip/is),
            })
        );
    });
});
