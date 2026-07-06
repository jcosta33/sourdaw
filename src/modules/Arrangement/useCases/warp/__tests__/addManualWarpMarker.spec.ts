import { beforeEach, describe, expect, it } from 'vitest';

import { warpStates } from '../../../stores/warpStates';
import { addManualWarpMarker } from '../addManualWarpMarker';

describe('addManualWarpMarker', () => {
    beforeEach(() => {
        warpStates.clear();
    });

    it('should add an owner-owned manual marker at the same original and warped beat', () => {
        addManualWarpMarker({ clipId: 'clip-1', beat: 3.5 });

        const marker = warpStates.get('clip-1')?.markers[0];
        expect(marker).toEqual({
            id: expect.stringMatching(/^warp-/),
            originalBeat: 3.5,
            warpedBeat: 3.5,
            origin: 'user',
            confidence: undefined,
            locked: false,
        });
    });
});
