import { describe, it, expect, vi } from 'vitest';
import { findClipById } from '../findClipById';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { TrackDummy } from '../../__tests__/TrackDummy';

vi.mock('../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

describe('findClipById', () => {
    it('should return null when track store state is not available', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null as any);
        expect(findClipById('clip-1')).toBeNull();
    });

    it('should return null when the clip is not found in any track', () => {
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [] }),
            TrackDummy.create({ id: 'track-2', clips: [{ id: 'clip-2' } as any] }),
        ];
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);
        expect(findClipById('clip-1')).toBeNull();
    });

    it('should return the clip and trackId when the clip is found', () => {
        const clip = { id: 'clip-1', name: 'Test Clip' };
        const tracks = [
            TrackDummy.create({ id: 'track-1', clips: [clip as any] }),
            TrackDummy.create({ id: 'track-2', clips: [] }),
        ];
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

        const result = findClipById('clip-1');
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
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

        const result = findClipById('clip-search');
        expect(result).toEqual({
            clip,
            trackId: 'track-2',
        });
    });
});
