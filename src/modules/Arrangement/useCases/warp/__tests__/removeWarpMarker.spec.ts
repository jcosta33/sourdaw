import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { warpStates } from '../../../stores/warpStates';
import { removeWarpMarker } from '../removeWarpMarker';

const clipId = WARP_AUDIO_CLIP_ID;

describe('removeWarpMarker', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('removes the named marker and undo restores it', async () => {
        warpStates.set(clipId, {
            enabled: true,
            markers: [
                { id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'repitch',
            originalTempo: null,
        });

        await removeWarpMarker(clipId, 'm1');
        expect(warpStates.get(clipId)?.markers.map((marker) => marker.id)).toEqual(['m2']);

        await undo();
        expect(warpStates.get(clipId)?.markers.map((marker) => marker.id)).toEqual(['m1', 'm2']);
    });
});
