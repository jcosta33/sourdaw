import { describe, expect, it } from 'vitest';

import { createWarpMarker, defaultWarpState } from '../WarpMarker';

describe('createWarpMarker', () => {
    it('creates markers with original and warped beat positions', () => {
        const m = createWarpMarker(0, 0);
        const n = createWarpMarker(4, 4.5);
        expect(m.originalBeat).toBe(0);
        expect(m.warpedBeat).toBe(0);
        expect(n.id).not.toBe(m.id);
        expect(n.id).toMatch(/^warp-\d+$/);
    });
});

describe('defaultWarpState', () => {
    it('disables warping with empty markers and complex stretch', () => {
        expect(defaultWarpState.enabled).toBe(false);
        expect(defaultWarpState.markers).toEqual([]);
        expect(defaultWarpState.stretchMode).toBe('complex');
        expect(defaultWarpState.originalTempo).toBeNull();
    });
});
