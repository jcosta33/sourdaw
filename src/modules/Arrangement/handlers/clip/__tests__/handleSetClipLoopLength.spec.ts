import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleSetClipLoopLength } from '../handleSetClipLoopLength';

const mocks = vi.hoisted(() => ({
    setClipLoopLength: vi.fn(),
}));

vi.mock('../../../useCases/clipLoop/setClipLoopLength', () => ({
    setClipLoopLength: mocks.setClipLoopLength,
}));

describe('handleSetClipLoopLength', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set(defaultTransportState);
        const clip = ClipDummy.create({ id: 'c1', endBeat: 8, loopLength: 2 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);
    });

    it('executes setClipLoopLength with the provided payload', () => {
        void handleSetClipLoopLength.execute({
            type: 'setClipLoopLength',
            payload: { clipId: 'c1', loopLength: 4 },
        });

        expect(mocks.setClipLoopLength).toHaveBeenCalledWith('c1', 4);
    });

    it('provides a description', () => {
        const desc = handleSetClipLoopLength.describe({
            type: 'setClipLoopLength',
            payload: { clipId: 'c1', loopLength: 4 },
        });
        expect(desc.label).toBe('Set clip loop length to 4 beats');
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipLoopLength',
            payload: {
                clipId: 'c1',
                expected: { present: true, value: 4 },
                replacement: { present: true, value: 2 },
            },
        });
    });

    it('is undoable', () => {
        expect(handleSetClipLoopLength.undoable).toBe(true);
    });
});
