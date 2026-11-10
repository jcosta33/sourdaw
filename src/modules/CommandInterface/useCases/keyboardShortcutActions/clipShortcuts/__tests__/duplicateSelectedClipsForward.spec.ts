import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type executeAppActionBatch } from '#/modules/Command/useCases';

type BatchResult = Awaited<ReturnType<typeof executeAppActionBatch>>;

const { mockTrackStore, mockExecuteAppActionBatch, mockNotifyUser, mockSetClipSelection, mockPrepareTargetId } =
    vi.hoisted(() => ({
        mockSetClipSelection: vi.fn(),
        mockPrepareTargetId: vi.fn<() => string>(),
        mockTrackStore: {
            value: {
                tracks: [
                    {
                        id: 't1',
                        name: 'Track 1',
                        clips: [
                            { id: 'c1', name: 'Clip A', startBeat: 0, endBeat: 4, type: 'audio' },
                            { id: 'c2', name: 'Clip B', startBeat: 8, endBeat: 12, type: 'midi' },
                        ],
                    },
                    {
                        id: 't2',
                        name: 'Track 2',
                        clips: [
                            { id: 'c3', name: 'Clip C', startBeat: 2, endBeat: 6, type: 'audio' },
                            { id: 'empty', name: 'Empty', startBeat: 20, endBeat: 20, type: 'audio' },
                        ],
                    },
                ],
            },
        },
        mockExecuteAppActionBatch: vi.fn<(...args: unknown[]) => Promise<BatchResult>>(),
        mockNotifyUser: vi.fn(),
    }));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mockTrackStore }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    prepareDuplicateClipTargetId: mockPrepareTargetId,
    setClipSelection: mockSetClipSelection,
}));
vi.mock('#/modules/Command/useCases', () => ({ executeAppActionBatch: mockExecuteAppActionBatch }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn() } }));

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

function dispatchedBatch() {
    expect(mockExecuteAppActionBatch).toHaveBeenCalledTimes(1);
    const [actions, options] = mockExecuteAppActionBatch.mock.calls[0] as [unknown[], Record<string, unknown>];
    return { actions, options };
}

describe('duplicateSelectedClipsForward', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        let nextCopy = 0;
        mockPrepareTargetId.mockImplementation(() => `copy-${String((nextCopy += 1))}`);
        mockExecuteAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('dispatches nothing when no clips are selected', async () => {
        await duplicateSelectedClipsForward([]);
        expect(mockExecuteAppActionBatch).not.toHaveBeenCalled();
    });

    it('dispatches nothing when the store has no value', async () => {
        const original = mockTrackStore.value;
        (mockTrackStore as { value: unknown }).value = null;
        await duplicateSelectedClipsForward(['c1']);
        mockTrackStore.value = original;
        expect(mockExecuteAppActionBatch).not.toHaveBeenCalled();
    });

    it('dispatches nothing when the selected ids match no clip', async () => {
        await duplicateSelectedClipsForward(['nonexistent']);
        expect(mockExecuteAppActionBatch).not.toHaveBeenCalled();
    });

    it('dispatches nothing when the selection spans no time', async () => {
        await duplicateSelectedClipsForward(['empty']);
        expect(mockExecuteAppActionBatch).not.toHaveBeenCalled();
    });

    it('dispatches one duplicateClipAt per selected clip in track order, each on its own track by the span', async () => {
        // Selection order differs from track order on purpose.
        await duplicateSelectedClipsForward(['c3', 'c2', 'c1']);

        // earliestStart = 0, latestEnd = 12, span = 12.
        const { actions } = dispatchedBatch();
        expect(actions).toEqual([
            {
                type: 'duplicateClipAt',
                payload: { clipId: 'c1', destinationTrackId: 't1', startBeat: 12, targetClipId: 'copy-1' },
            },
            {
                type: 'duplicateClipAt',
                payload: { clipId: 'c2', destinationTrackId: 't1', startBeat: 20, targetClipId: 'copy-2' },
            },
            {
                type: 'duplicateClipAt',
                payload: { clipId: 'c3', destinationTrackId: 't2', startBeat: 14, targetClipId: 'copy-3' },
            },
        ]);
    });

    it('runs every copy as one manual undo group', async () => {
        await duplicateSelectedClipsForward(['c1', 'c2']);

        const { options } = dispatchedBatch();
        expect(options).toEqual({
            groupId: expect.stringMatching(/^duplicate-clips-forward-.+/),
            groupLabel: 'Duplicate 2 clips forward',
            source: 'manual',
        });
    });

    it('labels a single copy in the singular', async () => {
        await duplicateSelectedClipsForward(['c1']);

        const { actions, options } = dispatchedBatch();
        expect(actions).toEqual([
            {
                type: 'duplicateClipAt',
                payload: { clipId: 'c1', destinationTrackId: 't1', startBeat: 4, targetClipId: 'copy-1' },
            },
        ]);
        expect(options.groupLabel).toBe('Duplicate 1 clip forward');
    });

    it('draws a fresh group for every press', async () => {
        await duplicateSelectedClipsForward(['c1']);
        await duplicateSelectedClipsForward(['c1']);

        const groupIds = mockExecuteAppActionBatch.mock.calls.map(
            (call) => (call[1] as Record<string, unknown>).groupId
        );
        expect(new Set(groupIds).size).toBe(2);
    });

    it.each(['rejected', 'conflicted'] as const)('tells the user when the batch is %s', async (status) => {
        mockExecuteAppActionBatch.mockResolvedValueOnce({ status, reason: 'project is locked', actions: [] });

        await duplicateSelectedClipsForward(['c1']);

        expect(mockNotifyUser).toHaveBeenCalledExactlyOnceWith(
            'Duplicate clips forward was refused: project is locked',
            'warning'
        );
    });

    it.each(['failed', 'cancelled'] as const)('propagates a %s batch instead of notifying', async (status) => {
        mockExecuteAppActionBatch.mockResolvedValueOnce({ status, reason: 'handler threw', actions: [] });

        await expect(duplicateSelectedClipsForward(['c1'])).rejects.toThrow(
            'Duplicate clips forward failed: handler threw'
        );
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    it('selects exactly the copies the batch named, so the next press chains after them', async () => {
        await duplicateSelectedClipsForward(['c3', 'c2', 'c1']);

        const { actions } = dispatchedBatch();
        const named = (actions as { payload: { targetClipId: string } }[]).map((action) => action.payload.targetClipId);
        expect(named).toEqual(['copy-1', 'copy-2', 'copy-3']);
        expect(mockSetClipSelection).toHaveBeenCalledExactlyOnceWith(named);
    });

    it.each(['committed-with-warning', 'executed', 'executed-with-warning'] as const)(
        'selects the copies when the batch ends %s',
        async (status) => {
            mockExecuteAppActionBatch.mockResolvedValueOnce({ status, warning: 'w', actions: [] });

            await duplicateSelectedClipsForward(['c1']);

            expect(mockSetClipSelection).toHaveBeenCalledExactlyOnceWith(['copy-1']);
        }
    );

    it.each(['rejected', 'conflicted'] as const)(
        'leaves the selection on the source when the batch is %s',
        async (status) => {
            mockExecuteAppActionBatch.mockResolvedValueOnce({ status, reason: 'locked', actions: [] });

            await duplicateSelectedClipsForward(['c1']);

            expect(mockSetClipSelection).not.toHaveBeenCalled();
        }
    );

    it.each(['failed', 'cancelled'] as const)('leaves the selection alone when the batch %s', async (status) => {
        mockExecuteAppActionBatch.mockResolvedValueOnce({ status, reason: 'boom', actions: [] });

        await expect(duplicateSelectedClipsForward(['c1'])).rejects.toThrow();
        expect(mockSetClipSelection).not.toHaveBeenCalled();
    });

    it('leaves the selection alone when the batch is a no-op or ambiguous', async () => {
        mockExecuteAppActionBatch.mockResolvedValueOnce({ status: 'no-op', actions: [] });
        mockExecuteAppActionBatch.mockResolvedValueOnce({ status: 'ambiguous', reason: 'x', actions: [] });

        await duplicateSelectedClipsForward(['c1']);
        await duplicateSelectedClipsForward(['c1']);

        expect(mockSetClipSelection).not.toHaveBeenCalled();
    });

    it('stays silent when the batch commits', async () => {
        await duplicateSelectedClipsForward(['c1']);
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });
});
