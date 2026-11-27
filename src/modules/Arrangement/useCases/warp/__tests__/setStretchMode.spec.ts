import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { createWarpMarker } from '../../../models/WarpMarker';
import { getWarpState, warpStates } from '../../../stores/warpStates';
import { setStretchMode } from '../setStretchMode';

const clipId = WARP_AUDIO_CLIP_ID;

describe('setStretchMode', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('writes the requested mode onto the clip warp state', async () => {
        await setStretchMode(clipId, 'wsola');

        expect(getWarpState(clipId).stretchMode).toBe('wsola');
    });

    it('leaves the rest of the warp state untouched', async () => {
        warpStates.set(clipId, {
            enabled: true,
            markers: [createWarpMarker(1, 2)],
            stretchMode: 'phase-vocoder',
            originalTempo: 120,
        });

        await setStretchMode(clipId, 'repitch');

        const after = getWarpState(clipId);
        expect(after.stretchMode).toBe('repitch');
        expect(after.enabled).toBe(true);
        expect(after.originalTempo).toBe(120);
        expect(after.markers.map((marker) => marker.warpedBeat)).toEqual([2]);
    });

    it('does not leak the write onto another clip', async () => {
        warpStates.set('clip-2', {
            enabled: false,
            markers: [],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });

        await setStretchMode(clipId, 'wsola');

        expect(getWarpState('clip-2').stretchMode).toBe('phase-vocoder');
    });
});
