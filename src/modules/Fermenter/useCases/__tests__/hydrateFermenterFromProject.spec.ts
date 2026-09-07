import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../models/FermenterPatch';
import { fermenterStore, getFermenterState, loadFermenterPatch } from '../../stores/fermenterStore';
import * as fermenterStoreModule from '../../stores/fermenterStore';
import { hydrateFermenterFromProject } from '../hydrateFermenterFromProject';

const DEVICE_ID = 'fermenter-test-device';

function makeTrack(parameterValues: Record<string, number>, deviceType = 'fermenter'): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Synth track', kind: 'midi' }),
        devices: [{ id: DEVICE_ID, name: 'Fermenter', type: deviceType, bypassed: false, parameterValues }],
    };
}

describe('hydrateFermenterFromProject', () => {
    beforeEach(() => {
        fermenterStore.set({});
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('returns null when device is missing or not a fermenter', () => {
        // No tracks
        expect(hydrateFermenterFromProject(DEVICE_ID)).toBeNull();

        // Track exists, but device ID does not match
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 800 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        expect(hydrateFermenterFromProject('other-device-id')).toBeNull();

        // Device ID matches, but device type is not 'fermenter'
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 800 }, 'gluten')],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        expect(hydrateFermenterFromProject(DEVICE_ID)).toBeNull();
    });

    it('hydrates stored numeric parameters and macros', () => {
        trackStore.set({
            tracks: [
                makeTrack({
                    filterCutoff: 600,
                    filterResonance: 8,
                    macro0: 0.8,
                    macro3: 0.25,
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const patch = hydrateFermenterFromProject(DEVICE_ID);

        expect(patch).not.toBeNull();
        expect(patch?.filterCutoff).toBe(600);
        expect(patch?.filterResonance).toBe(8);
        expect(patch?.macros[0]).toBe(0.8);
        expect(patch?.macros[3]).toBe(0.25);

        const state = getFermenterState(DEVICE_ID);
        expect(state.patch.filterCutoff).toBe(600);
        expect(state.patch.filterResonance).toBe(8);
        expect(state.patch.macros[0]).toBe(0.8);
        expect(state.patch.macros[3]).toBe(0.25);
    });

    it('preserves defaults for unpersisted parameters', () => {
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 600 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const patch = hydrateFermenterFromProject(DEVICE_ID);

        expect(patch?.filterCutoff).toBe(600);
        expect(patch?.filterResonance).toBe(DEFAULT_PATCH.filterResonance);
        expect(patch?.ampAttack).toBe(DEFAULT_PATCH.ampAttack);
        expect(patch?.ampRelease).toBe(DEFAULT_PATCH.ampRelease);
        expect(patch?.name).toBe(DEFAULT_PATCH.name);
        expect(patch?.macros[0]).toBe(DEFAULT_PATCH.macros[0]);
        expect(patch?.macros[1]).toBe(DEFAULT_PATCH.macros[1]);
    });

    it('ignores non-numeric or non-finite values', () => {
        trackStore.set({
            tracks: [
                makeTrack({
                    filterCutoff: Number.NaN,
                    filterResonance: Number.POSITIVE_INFINITY,
                    filterDrive: Number.NEGATIVE_INFINITY,
                    oscLevel: 'not-a-number' as unknown as number,
                    macro0: Number.NaN,
                    macro99: 0.5,
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const patch = hydrateFermenterFromProject(DEVICE_ID);

        expect(patch?.filterCutoff).toBe(DEFAULT_PATCH.filterCutoff);
        expect(patch?.filterResonance).toBe(DEFAULT_PATCH.filterResonance);
        expect(patch?.filterDrive).toBe(DEFAULT_PATCH.filterDrive);
        expect(patch?.oscLevel).toBe(DEFAULT_PATCH.oscLevel);
        expect(patch?.macros[0]).toBe(DEFAULT_PATCH.macros[0]);
        expect(patch?.macros).toEqual(DEFAULT_PATCH.macros);
        expect(patch?.macros).toHaveLength(8);
    });

    it('preserves active preset name and macroMappings during parameter hydration', () => {
        const customMacroMappings = [
            {
                targets: [
                    {
                        target: 'filterCutoff' as const,
                        center: 750,
                        depth: 500,
                        min: 20,
                        max: 20_000,
                        curve: 'exponential' as const,
                    },
                ],
            },
        ];
        const customPatch = {
            ...DEFAULT_PATCH,
            name: 'Warm Brass',
            macroMappings: customMacroMappings,
        };
        loadFermenterPatch(DEVICE_ID, customPatch);

        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 750 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const patch = hydrateFermenterFromProject(DEVICE_ID);

        expect(patch?.name).toBe('Warm Brass');
        expect(patch?.macroMappings).toEqual(customMacroMappings);
        expect(patch?.filterCutoff).toBe(750);

        const state = getFermenterState(DEVICE_ID);
        expect(state.patch.name).toBe('Warm Brass');
        expect(state.patch.macroMappings).toEqual(customMacroMappings);
    });

    it('is idempotent and does not call loadFermenterPatch when patch is unchanged', () => {
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 600, macro0: 0.8 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        // Initial hydration seeds the store
        hydrateFermenterFromProject(DEVICE_ID);
        expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(600);

        const loadSpy = vi.spyOn(fermenterStoreModule, 'loadFermenterPatch');
        const setSpy = vi.spyOn(fermenterStore, 'set');

        // Second call with unchanged track parameters
        const secondPatch = hydrateFermenterFromProject(DEVICE_ID);

        expect(secondPatch?.filterCutoff).toBe(600);
        expect(loadSpy).not.toHaveBeenCalled();
        expect(setSpy).not.toHaveBeenCalled();

        loadSpy.mockRestore();
        setSpy.mockRestore();
    });

    it('updates store when parameterValues change', () => {
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 600 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        hydrateFermenterFromProject(DEVICE_ID);
        expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(600);

        // Modify parameterValues (simulating project reload or undo)
        trackStore.set({
            tracks: [makeTrack({ filterCutoff: 1200 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        hydrateFermenterFromProject(DEVICE_ID);
        expect(getFermenterState(DEVICE_ID).patch.filterCutoff).toBe(1200);
    });
});
