import { describe, it, expect, beforeEach } from 'vitest';

import { defaultWarpState } from '../../../models/WarpMarker';
import { warpStates } from '../../../stores/warpStates';
import { enableWarp } from '../enableWarp';

describe('enableWarp', () => {
    beforeEach(() => {
        warpStates.clear();
    });

    it('enables warping on a fresh clip while recording the supplied original tempo', () => {
        enableWarp('clip-1', 128);

        const state = warpStates.get('clip-1');
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBe(128);
    });

    it('defaults the original tempo to null when none is supplied', () => {
        enableWarp('clip-2');

        const state = warpStates.get('clip-2');
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBeNull();
    });

    it('preserves existing warp markers when enabling on an already-configured clip', () => {
        // Seed a clip with a disabled state carrying markers.
        warpStates.set('clip-3', {
            ...defaultWarpState,
            enabled: false,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0, origin: 'user', confidence: 1, locked: false }],
        });

        enableWarp('clip-3', 120);

        const state = warpStates.get('clip-3');
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBe(120);
        expect(state?.markers).toHaveLength(1);
    });
});
