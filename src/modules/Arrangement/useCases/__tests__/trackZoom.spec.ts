import { describe, it, expect, vi } from 'vitest';

import { type Track } from '../../models/Track';
import { zoomTracksVertical } from '../trackZoom';

let lastHeight: number | undefined;

vi.mock('../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: (mapper: (track: Track) => Track) => {
        const base = { height: 64 } as unknown as Track;
        const next = mapper(base);
        lastHeight = next.height;
    },
}));

describe('zoomTracksVertical', () => {
    it('should clamp mapped track height between 30 and 300', () => {
        zoomTracksVertical(10);
        expect(lastHeight).toBe(74);
        zoomTracksVertical(400);
        expect(lastHeight).toBe(300);
        zoomTracksVertical(-200);
        expect(lastHeight).toBe(30);
    });
});
