import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { redo, undo } from '#/modules/Command/useCases';

import {
    closeWarpActionProject,
    openWarpActionProject,
    WARP_AUDIO_CLIP_ID,
} from '../../../__tests__/warpActionProject';
import { defaultWarpState } from '../../../models/WarpMarker';
import { warpStates } from '../../../stores/warpStates';
import { enableWarp } from '../enableWarp';

const clipId = WARP_AUDIO_CLIP_ID;

describe('enableWarp', () => {
    beforeEach(openWarpActionProject);
    afterEach(closeWarpActionProject);

    it('enables warping on a fresh clip while recording the supplied original tempo', async () => {
        await enableWarp(clipId, 128);

        const state = warpStates.get(clipId);
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBe(128);
    });

    it('defaults the original tempo to null when none is supplied', async () => {
        await enableWarp(clipId);

        const state = warpStates.get(clipId);
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBeNull();
    });

    it('preserves existing warp markers when enabling on an already-configured clip', async () => {
        warpStates.set(clipId, {
            ...defaultWarpState,
            enabled: false,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0, origin: 'user', confidence: 1, locked: false }],
        });

        await enableWarp(clipId, 120);

        const state = warpStates.get(clipId);
        expect(state?.enabled).toBe(true);
        expect(state?.originalTempo).toBe(120);
        expect(state?.markers).toHaveLength(1);
    });

    it('is undoable and redoable through the registry', async () => {
        await enableWarp(clipId, 128);

        await undo();
        expect(warpStates.has(clipId)).toBe(false);

        await redo();
        expect(warpStates.get(clipId)?.enabled).toBe(true);
    });
});
