import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../models/Track';
import { restoreTrackAtIndexWithDeferredAddedEvent } from '../restoreTrackAtIndexWithDeferredAddedEvent';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    getTrackState: vi.fn(),
    publishTrackAdded: vi.fn(),
    setTrackState: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../getTrackById', () => ({ getTrackById: mocks.getTrackById }));
vi.mock('../publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));

describe('restoreTrackAtIndexWithDeferredAddedEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores the canonical track snapshot at its captured index and defers its event', async () => {
        const sourceTrack = createTrack({ id: 'source-track', name: 'Source', kind: 'midi' });
        const tailTrack = createTrack({ id: 'tail-track', name: 'Tail', kind: 'audio' });
        const generatedTrack = createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' });
        generatedTrack.color = '#123456';
        generatedTrack.devices[0]!.id = 'stable-device';
        generatedTrack.activeAlternativeId = 'stable-alternative';
        generatedTrack.alternatives = [{ id: 'stable-alternative', name: 'Alternative 1', clips: [] }];
        generatedTrack.clips = [
            {
                id: 'generated-clip',
                trackId: generatedTrack.id,
                name: 'Bassline',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            },
        ];
        const trackJson = JSON.stringify(generatedTrack);
        mocks.getTrackState.mockReturnValue({
            tracks: [sourceTrack, tailTrack],
            selectedTrackId: sourceTrack.id,
            ghostClips: [],
        });

        const result = restoreTrackAtIndexWithDeferredAddedEvent({ trackJson, trackIndex: 1 });

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [sourceTrack, generatedTrack, tailTrack],
            selectedTrackId: sourceTrack.id,
            ghostClips: [],
        });
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();
        if (!result) {
            throw new Error('Expected exact track restoration');
        }
        expect(result.track.devices[0]?.id).toBe('stable-device');
        expect(result.track.activeAlternativeId).toBe('stable-alternative');

        await result.afterCommit();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: generatedTrack.id,
            name: generatedTrack.name,
            kind: generatedTrack.kind,
        });
    });

    it('rejects a non-canonical partial snapshot before writing', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        const trackJson = JSON.stringify({ id: 'generated-track', name: 'Bass', kind: 'midi', clips: [] });

        expect(restoreTrackAtIndexWithDeferredAddedEvent({ trackJson, trackIndex: 0 })).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();
    });
});
