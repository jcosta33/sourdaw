import { describe, expect, it } from 'vitest';

import { createWarpMarker, defaultWarpState } from '../WarpMarker';

// F9: the full UUID, not the truncated 8-hex-char prefix
// `crypto.randomUUID().slice(0, 8)` this id used to carry — truncating
// invited birthday collisions, per the lesson already documented for clip ids
// in `clipIdCounter.ts`, and warp markers are the most realistic route there
// given how many a long session produces.
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('createWarpMarker', () => {
    it('creates markers with original and warped beat positions', () => {
        const message = createWarpMarker(0, 0);
        const node = createWarpMarker(4, 4.5);
        expect(message.originalBeat).toBe(0);
        expect(message.warpedBeat).toBe(0);
        expect(node.id).not.toBe(message.id);
        expect(node.id).toMatch(new RegExp(`^warp-${UUID_BODY}$`, 'i'));
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
