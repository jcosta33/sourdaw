import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { createWarpMarker } from '../../../models/WarpMarker';
import { warpStates } from '../../../stores/warpStates';
import { disableWarp } from '../disableWarp';

const clipId = WARP_AUDIO_CLIP_ID;

describe('disableWarp', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('turns warping off and keeps the markers, and undo turns it back on', async () => {
        warpStates.set(clipId, {
            enabled: true,
            markers: [createWarpMarker(1, 2)],
            stretchMode: 'repitch',
            originalTempo: 120,
        });

        await disableWarp(clipId);
        expect(warpStates.get(clipId)).toMatchObject({ enabled: false, originalTempo: 120 });
        expect(warpStates.get(clipId)?.markers).toHaveLength(1);

        await undo();
        expect(warpStates.get(clipId)?.enabled).toBe(true);
    });
});
