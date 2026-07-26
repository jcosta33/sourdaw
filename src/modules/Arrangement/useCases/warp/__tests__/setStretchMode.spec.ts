import { beforeEach, describe, expect, it } from 'vitest';

import { createWarpMarker } from '../../../models/WarpMarker';
import { getWarpState, warpStates } from '../../../stores/warpStates';
import { setStretchMode } from '../setStretchMode';

describe('setStretchMode', () => {
    beforeEach(() => {
        warpStates.clear();
    });

    it('writes the requested mode onto the clip warp state', () => {
        setStretchMode('clip-1', 'repitch');

        expect(getWarpState('clip-1').stretchMode).toBe('repitch');
    });

    it('leaves the rest of the warp state untouched', () => {
        warpStates.set('clip-1', {
            enabled: true,
            markers: [createWarpMarker(1, 2)],
            stretchMode: 'complex',
            originalTempo: 120,
        });

        setStretchMode('clip-1', 'repitch');

        const after = getWarpState('clip-1');
        expect(after.stretchMode).toBe('repitch');
        expect(after.enabled).toBe(true);
        expect(after.originalTempo).toBe(120);
        expect(after.markers.map((marker) => marker.warpedBeat)).toEqual([2]);
    });

    it('does not leak the write onto another clip', () => {
        warpStates.set('clip-2', {
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });

        setStretchMode('clip-1', 'repitch');

        expect(getWarpState('clip-2').stretchMode).toBe('complex');
    });
});
