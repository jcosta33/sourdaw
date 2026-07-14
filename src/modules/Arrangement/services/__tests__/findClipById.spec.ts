import { describe, it, expect } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { findClipById } from '../findClipById';

describe('findClipById', () => {
    it('should return null when no tracks are available', () => {
        expect(findClipById({ clipId: 'clip-1', tracks: [] })).toBeNull();
    });

    it('should return null when the clip is not found in any track', () => {
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [] }),
            TrackDummy.create({ id: 'track-2', clips: [{ id: 'clip-2' } as any] }),
        ];
        expect(findClipById({ clipId: 'clip-1', tracks })).toBeNull();
    });

    it('should return the clip and trackId when the clip is found', () => {
        const clip = { id: 'clip-1', name: 'Test Clip' };
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [clip as any] }),
            TrackDummy.create({ id: 'track-2', clips: [] }),
        ];
        const result = findClipById({ clipId: 'clip-1', tracks });
        expect(result).toEqual({
            clip,
            trackId: 'track-1',
        });
    });

    it('should find the clip across multiple tracks', () => {
        const clip = { id: 'clip-search', name: 'Search Me' };
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [{ id: 'other' } as any] }),
            TrackDummy.create({ id: 'track-2', clips: [clip as any] }),
        ];
        const result = findClipById({ clipId: 'clip-search', tracks });
        expect(result).toEqual({
            clip,
            trackId: 'track-2',
        });
    });
});
