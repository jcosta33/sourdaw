import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { commitDsoEditPlan } from '../commitDsoEditPlan';

type RecordedUndoEntry = {
    action: AppAction;
    inverseAction: AppAction | null;
    label: string;
    source?: 'manual' | 'prompt' | 'voice' | 'ai';
    groupId?: string;
    groupLabel?: string;
};

const mocks = vi.hoisted(() => ({
    trackStoreValue: {
        value: {
            tracks: [{ id: 'track-1', name: 'Drums', clips: [], devices: [] }],
            selectedTrackId: 'track-1',
        },
    },
    transportStoreValue: { value: { isLooping: false } },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    snapshotTransaction: {},
    transactSnapshot: vi.fn(async (callback: (snapshotTransaction: object) => Promise<void>) => {
        await callback(mocks.snapshotTransaction);
        return {
            before: new Map([['before', { state: 'absent' as const }]]),
            after: new Map([['after', { state: 'absent' as const }]]),
        };
    }),
    commitActionUndoEntry: vi.fn<(input: RecordedUndoEntry) => void>(),
    pushAiActionGroup: vi.fn(),
    updateChatMessage: vi.fn(),
    logEdit: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    generateGroupId: mocks.generateGroupId,
    commitActionUndoEntry: mocks.commitActionUndoEntry,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    transactSnapshot: mocks.transactSnapshot,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

vi.mock('../../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../logEdit', () => ({
    logEdit: mocks.logEdit,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: mocks.warn,
        error: vi.fn(),
    },
}));

describe('commitDsoEditPlan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = {
            tracks: [{ id: 'track-1', name: 'Drums', clips: [], devices: [] }],
            selectedTrackId: 'track-1',
        };
        mocks.transportStoreValue.value = { isLooping: false };
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.transactSnapshot.mockImplementation(async (callback: (snapshotTransaction: object) => Promise<void>) => {
            await callback(mocks.snapshotTransaction);
            return {
                before: new Map([['before', { state: 'absent' as const }]]),
                after: new Map([['after', { state: 'absent' as const }]]),
            };
        });
    });

    it('should execute confirmed DSO edits through executeAppAction and record undo/history', async () => {
        const result = await commitDsoEditPlan({
            plan: {
                kind: 'edit_plan',
                moderation: 'allow',
                intent: 'remove drums',
                dsos: [{ op: 'remove_track', track_id: 'track-1' }],
            },
            userRequest: 'delete drums',
            assistantMessageId: 'assistant-1',
            reasoning: 'destructive remove',
        });

        expect(result).toEqual({ summaries: ['Removed track'], failures: [] });
        expect(mocks.transactSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'removeTrack', payload: { trackId: 'track-1' } },
            expect.objectContaining({
                source: 'ai',
                skipUndo: true,
                snapshotTransaction: mocks.snapshotTransaction,
            })
        );
        const recordedUndoEntry = mocks.commitActionUndoEntry.mock.calls[0]?.[0];
        expect(recordedUndoEntry).toMatchObject({
            label: 'AI: remove drums',
            source: 'ai',
            groupId: 'group-1',
            groupLabel: 'delete drums',
        });
        expect(recordedUndoEntry?.action.type).toBe('restoreDsoSnapshot');
        expect(recordedUndoEntry?.inverseAction?.type).toBe('restoreDsoSnapshot');
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'delete drums',
                actions: [{ kind: 'jsonEdit', label: 'Removed track' }],
                groupId: 'group-1',
            })
        );
    });
});
