import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { registerToasterDevice, toasterStore, toggleStep, updatePad } from '../../stores/toasterStore';
import { hydrateToasterKitFromProject } from '../hydrateToasterKitFromProject';
import { initToasterKitPersistence } from '../initToasterKitPersistence';

const DEVICE_ID = 'toaster-1';

// Built through the projection rather than a `Track` literal, so the fixture is a
// track the document could actually produce — and so this spec stays on the
// Arrangement contract barrel instead of reaching into its models.
function makeToasterTracks(): Track[] {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: { masterGain: 1 },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

/**
 * A Toaster kit is not numeric leaves: it carries 16 pads with names, colours and
 * mute/solo booleans plus an array of step patterns. `parameterValues` can hold none
 * of that, so the kit rides a device-state chunk instead.
 *
 * This is the round trip the product needs, through the real write path: edit the kit
 * the way the panel does, let the persistence subscriber mirror it into project truth
 * through `executeAppAction`, project the document the way a reload does, and rebuild
 * the kit from what came back.
 *
 * The projection step is what makes this a real test rather than a store echo.
 * `sanitizeTrackSnapshot` is the exact function the CRDT hydrate and the file-import
 * restore both run through, and it rebuilds devices field by field from a whitelist —
 * so a field it does not carry is a field that does not survive a reload, no matter
 * what the store held a moment earlier.
 */
describe('Toaster kit persistence round trip', () => {
    let stopPersistence: () => void;

    beforeEach(async () => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeToasterTracks() });
        toasterStore.set({});
        stopPersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID, hydrateToasterKitFromProject(DEVICE_ID) ?? undefined);
        await Promise.resolve();
    });

    afterEach(() => {
        stopPersistence();
    });

    it('carries an edited pattern step, pad name and pad mute through a project reload', async () => {
        // Edit the kit the way the panel does — the panel calls these store mutators
        // directly, so this is the path a real step toggle and mute click take.
        toggleStep(DEVICE_ID, 3, 5);
        updatePad(DEVICE_ID, 3, { muted: true, name: 'Rimshot' });
        await Promise.resolve();

        // Reload: project the document, then rebuild the session from it alone.
        const projected = sanitizeTrackSnapshot(trackStore.value);
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        toasterStore.set({});
        registerToasterDevice(DEVICE_ID, hydrateToasterKitFromProject(DEVICE_ID) ?? undefined);

        const reloaded = toasterStore.value?.[DEVICE_ID]?.kit;
        const activePattern = reloaded?.patterns.find((pattern) => pattern.id === reloaded.activePatternId);

        expect(activePattern?.tracks[3]?.steps[5]?.active).toBe(true);
        expect(reloaded?.pads[3]?.name).toBe('Rimshot');
        expect(reloaded?.pads[3]?.muted).toBe(true);
        // A step the user never touched must come back off, or "survives a reload"
        // would also be satisfied by a projection that turned everything on.
        expect(activePattern?.tracks[3]?.steps[4]?.active).toBe(false);
        expect(reloaded?.pads[2]?.muted).toBe(false);
    });
});
