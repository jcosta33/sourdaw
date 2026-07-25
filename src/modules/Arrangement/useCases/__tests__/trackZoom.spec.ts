import { describe, it, expect, vi } from 'vitest';

import { type Track } from '../../models/Track';
import { zoomTracksVertical } from '../trackZoom';

let baseHeight: number | undefined;
let lastHeight: number | undefined;

vi.mock('../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: (mapper: (track: Track) => Track) => {
        const base = { height: baseHeight } as unknown as Track;
        const next = mapper(base);
        lastHeight = next.height;
    },
}));

describe('zoomTracksVertical', () => {
    it('should clamp mapped track height between 30 and 300', () => {
        baseHeight = 64;
        zoomTracksVertical(10);
        expect(lastHeight).toBe(74);
        zoomTracksVertical(400);
        expect(lastHeight).toBe(300);
        zoomTracksVertical(-200);
        expect(lastHeight).toBe(30);
    });

    it('should default a missing height to 64 before applying the delta', () => {
        // height is undefined on the track: the `(time.height ?? 64)` fallback fires.
        baseHeight = undefined;
        zoomTracksVertical(6);
        expect(lastHeight).toBe(70); // 64 default + 6
    });
});
