import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { createTrack as modelCreateTrack } from '../../models/Track';
import { createTrack } from '../createTrack';

vi.mock('../../models/Track', () => ({
    createTrack: vi.fn(),
    normalizeTrack: vi.fn(),
}));

describe('createTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to the Arrangement model createTrack and return its track', () => {
        const input = { name: 'Lead', kind: 'midi' as const, parentId: 'folder-1' };
        const expectedTrack = TrackDummy.create({
            id: 'track-created',
            name: 'Lead',
            kind: 'midi',
            parentId: 'folder-1',
        });
        vi.mocked(modelCreateTrack).mockReturnValue(expectedTrack);

        const track = createTrack(input);

        expect(modelCreateTrack).toHaveBeenCalledTimes(1);
        expect(modelCreateTrack).toHaveBeenCalledWith(input);
        expect(track).toBe(expectedTrack);
    });
});
