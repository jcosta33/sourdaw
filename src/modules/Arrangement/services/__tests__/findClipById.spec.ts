import { describe, it, expect } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { findClipById } from '../findClipById';

function createClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        id: overrides.id,
        trackId: 'track-1',
        name: 'Test Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('findClipById', () => {
    it('should return null when no tracks are available', () => {
        expect(findClipById({ clipId: 'clip-1', tracks: [] })).toBeNull();
    });

    it('should return null when the clip is not found in any track', () => {
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [] }),
            TrackDummy.create({ id: 'track-2', clips: [createClip({ id: 'clip-2' })] }),
        ];
        expect(findClipById({ clipId: 'clip-1', tracks })).toBeNull();
    });

    it('should return the clip and trackId when the clip is found', () => {
        const clip = createClip({ id: 'clip-1' });
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [clip] }),
            TrackDummy.create({ id: 'track-2', clips: [] }),
        ];
        const result = findClipById({ clipId: 'clip-1', tracks });
        expect(result).toEqual({
            clip,
            trackId: 'track-1',
        });
    });

    it('should find the clip across multiple tracks', () => {
        const clip = createClip({ id: 'clip-search', name: 'Search Me', trackId: 'track-2' });
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [createClip({ id: 'other' })] }),
            TrackDummy.create({ id: 'track-2', clips: [clip] }),
        ];
        const result = findClipById({ clipId: 'clip-search', tracks });
        expect(result).toEqual({
            clip,
            trackId: 'track-2',
        });
    });
});
