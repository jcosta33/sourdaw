import { describe, it, expect, vi, beforeEach } from 'vitest';

import { commitDsoEditPlan } from '../commitDsoEditPlan';

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
    transactSnapshot: vi.fn(async (callback: () => Promise<void>) => {
        await callback();
        return { before: new Map([['before', 'snapshot']]), after: new Map([['after', 'snapshot']]) };
    }),
    commitActionUndoEntry: vi.fn(),
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
}));

vi.mock('#/modules/Command/stores', () => ({
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

vi.mock('../serializeLogicalState', () => ({
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
        mocks.transactSnapshot.mockImplementation(async (callback: () => Promise<void>) => {
            await callback();
            return { before: new Map([['before', 'snapshot']]), after: new Map([['after', 'snapshot']]) };
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
            expect.objectContaining({ source: 'ai', skipUndo: true })
        );
        expect(mocks.commitActionUndoEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                label: 'AI: remove drums',
                action: expect.objectContaining({ type: 'restoreDsoSnapshot' }),
                inverseAction: expect.objectContaining({ type: 'restoreDsoSnapshot' }),
                source: 'ai',
                groupId: 'group-1',
                groupLabel: 'delete drums',
            })
        );
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'delete drums',
                actions: [{ kind: 'jsonEdit', label: 'Removed track' }],
                groupId: 'group-1',
            })
        );
    });
});
