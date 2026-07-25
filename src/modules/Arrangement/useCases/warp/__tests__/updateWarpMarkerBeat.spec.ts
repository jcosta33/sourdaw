import { beforeEach, describe, expect, it } from 'vitest';

import { warpStates } from '../../../stores/warpStates';
import { updateWarpMarkerBeat } from '../updateWarpMarkerBeat';

describe('updateWarpMarkerBeat', () => {
    beforeEach(() => {
        warpStates.clear();
    });

    it('should update the target marker warped beat', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'm1', field: 'warpedBeat', beat: 1.5 });

        expect(warpStates.get('c1')?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 1,
            warpedBeat: 1.5,
            origin: 'user',
        });
    });

    it('should update the target marker original beat', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.25, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'm1', field: 'originalBeat', beat: 0.75 });

        expect(warpStates.get('c1')?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 0.75,
            warpedBeat: 1.25,
            origin: 'user',
        });
    });

    it('should not create warp state for a missing clip', () => {
        updateWarpMarkerBeat({ clipId: 'missing', markerId: 'm1', field: 'warpedBeat', beat: 1.5 });

        expect(warpStates.has('missing')).toBe(false);
    });

    it('should be a no-op when the marker id is unknown', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'nope', field: 'warpedBeat', beat: 9 });

        // No marker matches, so nothing is rewritten.
        expect(warpStates.get('c1')?.markers[0]?.warpedBeat).toBe(1);
    });

    it('should be a no-op when the new beat equals the existing value', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.5, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'm1', field: 'warpedBeat', beat: 1.5 });

        expect(warpStates.get('c1')?.markers[0]?.warpedBeat).toBe(1.5);
    });
});
