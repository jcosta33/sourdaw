import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { warpStates } from '../../../stores/warpStates';
import { addManualWarpMarker } from '../addManualWarpMarker';

const clipId = WARP_AUDIO_CLIP_ID;

describe('addManualWarpMarker', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('should add an owner-owned manual marker at the same original and warped beat', async () => {
        await addManualWarpMarker({ clipId, beat: 3.5 });

        const marker = warpStates.get(clipId)?.markers[0];
        expect(marker).toEqual({
            id: expect.stringMatching(/^warp-/),
            originalBeat: 3.5,
            warpedBeat: 3.5,
            origin: 'user',
            locked: false,
        });
    });

    // The first marker is built by `createWarpMarker` (`confidence: undefined`), so the second add is
    // guarded on a live state whose stored shape differs from the wire snapshot until both are normalized.
    it('applies two consecutive adds, keeps them ordered by original beat, and undo removes only the last', async () => {
        await addManualWarpMarker({ clipId, beat: 5 });
        await addManualWarpMarker({ clipId, beat: 2 });
        expect(warpStates.get(clipId)?.markers.map((marker) => marker.originalBeat)).toEqual([2, 5]);

        await undo();

        expect(warpStates.get(clipId)?.markers.map((marker) => marker.originalBeat)).toEqual([5]);
    });
});
