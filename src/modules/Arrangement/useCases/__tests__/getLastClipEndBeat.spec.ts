import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { addClip } from '../clip/addClip';
import { createTrack } from '../createTrack';
import { getLastClipEndBeat } from '../getLastClipEndBeat';
import { setTrackStoreState } from '../setTrackStoreState';

describe('getLastClipEndBeat', () => {
    beforeEach(() => trackStore.set(defaultTrackState));

    it('returns the greatest clip end across every arrangement track', () => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                createTrack({ id: 'track-a', name: 'A', kind: 'audio' }),
                createTrack({ id: 'track-b', name: 'B', kind: 'audio' }),
            ],
        });
        expect(
            addClip({ id: 'clip-a', trackId: 'track-a', name: 'A', startBeat: 0, endBeat: 8, type: 'audio' })
        ).not.toBeNull();
        expect(
            addClip({ id: 'clip-b', trackId: 'track-b', name: 'B', startBeat: 2, endBeat: 16, type: 'audio' })
        ).not.toBeNull();

        expect(getLastClipEndBeat()).toBe(16);
    });

    it('returns zero when there are no clips', () => {
        expect(getLastClipEndBeat()).toBe(0);
    });
});
