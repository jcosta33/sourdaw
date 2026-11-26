import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { warpStates } from '../../../stores/warpStates';
import { removeWarpMarkers } from '../removeWarpMarkers';

const clipId = WARP_AUDIO_CLIP_ID;

describe('removeWarpMarkers', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('removes several markers in one action so a single undo restores them all', async () => {
        warpStates.set(clipId, {
            enabled: true,
            markers: ['m1', 'm2', 'm3'].map((id, index) => ({
                id,
                originalBeat: index,
                warpedBeat: index,
                origin: 'user' as const,
            })),
            stretchMode: 'repitch',
            originalTempo: null,
        });

        await removeWarpMarkers(clipId, ['m1', 'm3']);
        expect(warpStates.get(clipId)?.markers.map((marker) => marker.id)).toEqual(['m2']);

        await undo();
        expect(warpStates.get(clipId)?.markers.map((marker) => marker.id)).toEqual(['m1', 'm2', 'm3']);
    });
});
