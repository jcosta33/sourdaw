import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createPatternInstance } from '../createPatternInstance';

const mocks = vi.hoisted(() => ({
    trackStoreValue: null as unknown,
    appendClipToTrack: vi.fn(),
    getNotesForClip: vi.fn(() => []),
    setNotesForClip: vi.fn(),
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
        const [appendedTrackId, appendedInstance] = mocks.appendClipToTrack.mock.calls[0] as [string, any];
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

    it('bails if source clip not found', () => {
        mocks.trackStoreValue = { tracks: [] };
        expect(createPatternInstance('missing', 't1', 0)).toBeNull();
    });
});
