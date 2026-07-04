import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { normalizeTrack as modelNormalizeTrack } from '../../models/Track';
import { normalizeTrack } from '../normalizeTrack';

vi.mock('../../models/Track', () => ({
    createTrack: vi.fn(),
    normalizeTrack: vi.fn(),
}));

describe('normalizeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to the Arrangement model normalizeTrack and return its track', () => {
        const input = { id: 'track-imported', name: 'Imported Audio', kind: 'audio' as const, muted: true };
        const expectedTrack = TrackDummy.create({
            id: 'track-imported',
            name: 'Imported Audio',
            muted: true,
        });
        vi.mocked(modelNormalizeTrack).mockReturnValue(expectedTrack);

        const track = normalizeTrack(input);

        expect(modelNormalizeTrack).toHaveBeenCalledTimes(1);
        expect(modelNormalizeTrack).toHaveBeenCalledWith(input);
        expect(track).toBe(expectedTrack);
    });
});
