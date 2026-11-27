import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { warpStates } from '../../../stores/warpStates';
import { toggleWarpMarkerLock } from '../toggleWarpMarkerLock';

const clipId = WARP_AUDIO_CLIP_ID;

describe('toggleWarpMarkerLock', () => {
    beforeEach(() => {
        openWarpActionProject();
        warpStates.set(clipId, {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' }],
            stretchMode: 'repitch',
            originalTempo: null,
        });
    });
    afterEach(closeWarpActionProject);

    it('locks an unlocked marker and undo unlocks it', async () => {
        await toggleWarpMarkerLock(clipId, 'm1');
        expect(warpStates.get(clipId)?.markers[0]?.locked).toBe(true);

        await undo();
        expect(warpStates.get(clipId)?.markers[0]?.locked).not.toBe(true);
    });

    it('does nothing for an absent marker', async () => {
        await toggleWarpMarkerLock(clipId, 'absent');

        expect(warpStates.get(clipId)?.markers[0]?.locked).toBeUndefined();
    });
});
