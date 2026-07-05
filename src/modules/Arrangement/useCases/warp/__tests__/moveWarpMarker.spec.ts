import { describe, it, expect } from 'vitest';

import { warpStates } from '../../../stores/warpStates';
import { moveWarpMarker } from '../moveWarpMarker';

describe('moveWarpMarker', () => {
    it('should update only the target marker warped beat', () => {
        warpStates.clear();
        warpStates.set('c1', {
            enabled: true,
            markers: [
                { id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });

        moveWarpMarker('c1', 'm1', 1.75);

        expect(warpStates.get('c1')?.markers).toEqual([
            { id: 'm1', originalBeat: 1, warpedBeat: 1.75, origin: 'user' },
            { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
        ]);
    });
});
