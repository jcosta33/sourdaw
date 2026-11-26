import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { redo, undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { type WarpState } from '../../../models/WarpMarker';
import { getStoredWarpState, warpStates } from '../../../stores/warpStates';
import { commitWarpMarkerBeatDrag } from '../commitWarpMarkerBeatDrag';

const clipId = WARP_AUDIO_CLIP_ID;
const BEFORE_DRAG: WarpState = {
    enabled: true,
    markers: [
        { id: 'm1', originalBeat: 1, warpedBeat: 2, origin: 'user' },
        { id: 'm2', originalBeat: 4, warpedBeat: 4, origin: 'user' },
    ],
    stretchMode: 'phase-vocoder',
    originalTempo: null,
};

describe('commitWarpMarkerBeatDrag', () => {
    beforeEach(() => {
        openWarpActionProject();
        warpStates.set(clipId, BEFORE_DRAG);
    });

    afterEach(closeWarpActionProject);

    it('commits the drag as one action whose single undo restores the pre-drag markers', async () => {
        await commitWarpMarkerBeatDrag({ clipId, markerId: 'm1', originalBeat: 1.25, warpedBeat: 2.5 });

        expect(getStoredWarpState(clipId)?.markers).toEqual([
            { id: 'm1', originalBeat: 1.25, warpedBeat: 2.5, origin: 'user' },
            { id: 'm2', originalBeat: 4, warpedBeat: 4, origin: 'user' },
        ]);

        await undo();
        expect(getStoredWarpState(clipId)).toEqual(BEFORE_DRAG);

        await redo();
        expect(getStoredWarpState(clipId)?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 1.25,
            warpedBeat: 2.5,
            origin: 'user',
        });
    });

    it('keeps a change to the field the drag did not move that landed while the drag was in flight', async () => {
        // A peer write or an Undo changes originalBeat after the drag started and before it is released.
        warpStates.set(clipId, {
            ...BEFORE_DRAG,
            markers: [{ id: 'm1', originalBeat: 1.5, warpedBeat: 2, origin: 'user' }, BEFORE_DRAG.markers[1]!],
        });

        await commitWarpMarkerBeatDrag({ clipId, markerId: 'm1', warpedBeat: 2.5 });

        expect(getStoredWarpState(clipId)?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 1.5,
            warpedBeat: 2.5,
            origin: 'user',
        });
    });

    it('records no history entry when the marker ends where it started', async () => {
        await commitWarpMarkerBeatDrag({ clipId, markerId: 'm1', originalBeat: 1, warpedBeat: 2 });

        await undo();

        expect(getStoredWarpState(clipId)).toEqual(BEFORE_DRAG);
    });

    it('does not create warp state for a missing clip', async () => {
        await commitWarpMarkerBeatDrag({ clipId: 'missing', markerId: 'm1', originalBeat: 1, warpedBeat: 2 });

        expect(warpStates.has('missing')).toBe(false);
    });

    it('leaves the state alone when the marker id is absent', async () => {
        await commitWarpMarkerBeatDrag({ clipId, markerId: 'absent', originalBeat: 1, warpedBeat: 9 });

        expect(getStoredWarpState(clipId)).toEqual(BEFORE_DRAG);
    });
});
