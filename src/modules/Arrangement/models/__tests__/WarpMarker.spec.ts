import { describe, expect, it } from 'vitest';

import { createWarpMarker, defaultWarpState } from '../WarpMarker';

describe('createWarpMarker', () => {
    it('creates markers with original and warped beat positions', () => {
        const message = createWarpMarker(0, 0);
        const node = createWarpMarker(4, 4.5);
        expect(message.originalBeat).toBe(0);
        expect(message.warpedBeat).toBe(0);
        expect(node.id).not.toBe(message.id);
        expect(node.id).toMatch(/^warp-[a-f0-9]{8}$/i);
    });
});

describe('defaultWarpState', () => {
    it('disables warping with empty markers and the repitch stretch mode', () => {
        expect(defaultWarpState.enabled).toBe(false);
        expect(defaultWarpState.markers).toEqual([]);
        expect(defaultWarpState.stretchMode).toBe('repitch');
        expect(defaultWarpState.originalTempo).toBeNull();
    });
});
