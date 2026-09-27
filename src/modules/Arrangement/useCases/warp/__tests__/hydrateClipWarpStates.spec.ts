import { beforeEach, describe, expect, it } from 'vitest';

import {
    __resetWarpStatesForTest,
    getStoredWarpState,
    getWarpState,
    hasNonDefaultWarpState,
} from '../../../stores/warpStates';
import { hydrateClipWarpStates } from '../hydrateClipWarpStates';

describe('hydrateClipWarpStates', () => {
    beforeEach(() => {
        __resetWarpStatesForTest();
    });

    it('loads markers from a project-file array, mapping a legacy stretch mode, and replaces prior in-memory state', () => {
        // `beats` is a pre-ADR 0024 id an older project file still carries;
        // the store must hold its mapped canonical mode, `wsola`.
        hydrateClipWarpStates([
            {
                clipId: 'clip-a',
                enabled: true,
                markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.5, origin: 'user' }],
                stretchMode: 'beats',
                originalTempo: 100,
            },
        ]);

        expect(getWarpState('clip-a')).toEqual({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.5, origin: 'user' }],
            stretchMode: 'wsola',
            originalTempo: 100,
        });
        expect(hasNonDefaultWarpState('clip-a')).toBe(true);
    });

    it('clears prior markers when the project field is missing', () => {
        hydrateClipWarpStates([
            {
                clipId: 'prior',
                enabled: true,
                markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0 }],
                stretchMode: 'repitch',
                originalTempo: null,
            },
        ]);
        expect(getStoredWarpState('prior')).toBeDefined();

        hydrateClipWarpStates(undefined);
        expect(getStoredWarpState('prior')).toBeUndefined();
    });

    it('drops a default-shaped row so it does not appear as a stored satellite', () => {
        hydrateClipWarpStates([
            {
                clipId: 'clip-default',
                enabled: false,
                markers: [],
                stretchMode: 'repitch',
                originalTempo: null,
            },
        ]);
        expect(getStoredWarpState('clip-default')).toBeUndefined();
    });
});
