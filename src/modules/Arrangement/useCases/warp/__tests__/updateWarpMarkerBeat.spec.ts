import { describe, it, expect } from 'vitest';

import { warpStates } from '../../../stores/warpStates';
import { updateWarpMarkerBeat } from '../updateWarpMarkerBeat';

describe('updateWarpMarkerBeat', () => {
    it('should update the target marker warped beat', () => {
        warpStates.clear();
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
        warpStates.clear();
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
});
