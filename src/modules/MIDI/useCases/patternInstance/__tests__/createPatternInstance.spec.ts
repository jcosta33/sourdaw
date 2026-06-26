import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createPatternInstance } from '../createPatternInstance';

const mocks = vi.hoisted(() => ({
    trackStoreValue: null as unknown,
    appendClipToTrack: vi.fn<(...args: unknown[]) => void>(),
    getNotesForClip: vi.fn<() => unknown[]>(() => []),
    setNotesForClip: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
    appendClipToTrack: mocks.appendClipToTrack,
}));

vi.mock('../../../useCases/midiNoteCrud/getNotesForClip', () => ({
    getNotesForClip: mocks.getNotesForClip,
}));

vi.mock('../../../useCases/midiNoteCrud/setNotesForClip', () => ({
    setNotesForClip: mocks.setNotesForClip,
}));

describe('createPatternInstance', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates a linked clip instance and clones notes with offset', () => {
        const sourceClip = {
            id: 'cBase',
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Loop',
            type: 'midi',
        };
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [sourceClip] }],
        };

        const mockNotes = [{ id: 'n1', startBeat: 1, pitch: 60 }];
        mocks.getNotesForClip.mockReturnValue(mockNotes);

        // Create instance at beat 16 on track t2
        const instanceId = createPatternInstance('cBase', 't1', 16);

        expect(instanceId).toMatch(/^clip-inst-/);

        // Verify track state update
        expect(mocks.appendClipToTrack).toHaveBeenCalledTimes(1);
        const [appendedTrackId, appendedInstance] = mocks.appendClipToTrack.mock.calls[0] as [
            string,
            { id: string; parentClipId?: string; startBeat: number; endBeat: number; name: string },
        ];
        expect(appendedTrackId).toBe('t1');

        expect(appendedInstance).toMatchObject({
            id: instanceId,
            parentClipId: 'cBase',
            startBeat: 16,
            endBeat: 20,
            name: 'Loop (instance)',
        });

        // Verify note cloning with offset (16 - 0 = 16)
        expect(mocks.setNotesForClip).toHaveBeenCalledWith(instanceId, [
            expect.objectContaining({
                pitch: 60,
                startBeat: 17, // 1 + 16
            }),
        ]);
    });

    it('mints deterministic instance note ids derived from (instance clip, parent note)', () => {
        const sourceClip = {
            id: 'cBase',
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Loop',
            type: 'midi',
        };
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [sourceClip] }],
        };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 1, pitch: 60 }]);

        const instanceId = createPatternInstance('cBase', 't1', 16);
        expect(instanceId).not.toBeNull();

        // Identity must match propagateParentChanges' scheme `note-inst-${clip.id}-${node.id}`
        // so the first parent edit re-derives the same ids instead of replacing them.
        const [targetClipId, clonedNotes] = mocks.setNotesForClip.mock.calls[0] as [string, Array<{ id: string }>];
        expect(targetClipId).toBe(instanceId);
        expect(clonedNotes[0]?.id).toBe(`note-inst-${targetClipId}-n1`);
    });

    it('bails if source clip not found', () => {
        mocks.trackStoreValue = { tracks: [] };
        expect(createPatternInstance('missing', 't1', 0)).toBeNull();
    });

    it('does not write notes to the store when the target track is missing', () => {
        const sourceClip = {
            id: 'cBase',
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Loop',
            type: 'midi',
        };
        // Source clip lives on t1, but the target track t2 does not exist.
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [sourceClip] }],
        };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 1, pitch: 60 }]);

        const result = createPatternInstance('cBase', 't2', 16);

        expect(result).toBeNull();
        // No orphaned notes: the failure path must not mutate the store.
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
    });
});
