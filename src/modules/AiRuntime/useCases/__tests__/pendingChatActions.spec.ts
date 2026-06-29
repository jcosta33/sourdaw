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
    describeAction: vi.fn(() => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    commitActionUndoEntry: vi.fn(),
    pushAiActionGroup: vi.fn(),
    updateChatMessage: vi.fn(),
    notifyAiChange: vi.fn(),
    validateDsos: vi.fn(() => []),
    executeDsos: vi.fn(async () => ({ summaries: ['Removed track'], failures: [] })),
    transactSnapshot: vi.fn(async (callback: () => Promise<void>) => {
        await callback();
        return { before: new Map(), after: new Map() };
    }),
    logEdit: vi.fn(),
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
    describeAction: mocks.describeAction,
    generateGroupId: mocks.generateGroupId,
}));

vi.mock('#/modules/Command/stores', () => ({
    commitActionUndoEntry: mocks.commitActionUndoEntry,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    transactSnapshot: mocks.transactSnapshot,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreState.value;
        },
    },
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

vi.mock('../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

vi.mock('../dsoEditor/compileDso', () => ({
    validateDsos: mocks.validateDsos,
    executeDsos: mocks.executeDsos,
}));

vi.mock('../dsoEditor/serializeLogicalState', () => ({
    logEdit: mocks.logEdit,
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
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.validateDsos.mockReturnValue([]);
        mocks.executeDsos.mockResolvedValue({ summaries: ['Removed track'], failures: [] });
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
        mocks.transactSnapshot.mockImplementation(async (callback: () => Promise<void>) => {
            await callback();
            return { before: new Map(), after: new Map() };
        });
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

        expect(mocks.executeDsos).not.toHaveBeenCalled();
        expect(mocks.commitActionUndoEntry).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-dso-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(mocks.validateDsos).toHaveBeenCalledWith(pendingDsoPlan.dsos);
        expect(mocks.executeDsos).toHaveBeenCalledWith(pendingDsoPlan.dsos);
        expect(mocks.commitActionUndoEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                label: 'AI: remove drums',
                action: expect.objectContaining({ type: 'restoreDsoSnapshot' }),
                inverseAction: expect.objectContaining({ type: 'restoreDsoSnapshot' }),
                source: 'ai',
                groupId: 'group-1',
            })
        );
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'delete drums',
                actions: [{ kind: 'jsonEdit', label: 'Removed track' }],
                groupId: 'group-1',
            })
        );
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
        expect(mocks.validateDsos).not.toHaveBeenCalled();
        expect(mocks.executeDsos).not.toHaveBeenCalled();
        expect(mocks.commitActionUndoEntry).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
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

    it('should record failed confirmation execution without dropping the proposal record', async () => {
        mocks.executeAppAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('remove clip failed'));
        mocks.describeAction.mockReturnValueOnce('Remove track');
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason: 'remove clip failed' });
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: 'remove clip failed',
                pendingActionConfirmationStatus: 'failed',
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('failed');
        expect(getPendingActionConfirmation('confirm-1')?.error).toBe('remove clip failed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track' },
        ]);
    });
});
