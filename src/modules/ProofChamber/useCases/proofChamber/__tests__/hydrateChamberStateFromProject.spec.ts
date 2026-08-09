import { describe, it, expect, beforeEach } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';

import {
    ALGORITHM_MAP,
    BOOLEAN_ENGINE_FIELDS,
    DEFAULT_PARAMS,
    NUMERIC_ENGINE_FIELDS,
    PARAM_MAP,
} from '../../../models/ProofChamberState';
import { chamberStore } from '../../../stores/chamberStore';
import { hydrateChamberStateFromProject } from '../hydrateChamberStateFromProject';
import { registerChamberInstance } from '../registerChamberInstance';

/**
 * `chamberStore` has two writers and both are the panel. Nothing projects
 * project truth back into it, so before this use case existed the store started
 * every session at `DEFAULT_PARAMS` while the *engine* was replayed from
 * `Device.parameterValues` by `projectTrackToLiveStrip`.
 *
 * That is a wrong label on any device. On the Dutch Oven since #1519 it is a
 * wrong *gate*: the panel decides which controls the live algorithm can hear by
 * reading `params.algorithm` out of this store, so a project saved on Reverse
 * reopening as Plate offered all fifteen dead controls fully interactive.
 */

const DEVICE_ID = 'chamber-1';

/**
 * Built here rather than imported from Arrangement's dummy factory: a spec in
 * another module reaching into Arrangement's private models is exactly what the
 * tests cruise forbids, and the shape a hydration reads is three fields deep.
 */
function chamberTrack(parameterValues: Record<string, number>): Track {
    return {
        id: 'track-1',
        name: 'Reverb bus',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ffff',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Dutch Oven', type: 'dutch-oven', bypassed: false, parameterValues }],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiFx: [],
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function seedProject(parameterValues: Record<string, number>): void {
    trackStore.set({ tracks: [chamberTrack(parameterValues)], selectedTrackId: 'track-1', ghostClips: [] });
}

function engineState() {
    const state = chamberStore.value?.instances[DEVICE_ID]?.engineState;
    if (!state) {
        throw new Error('no chamber instance registered');
    }
    return state;
}

describe('hydrateChamberStateFromProject', () => {
    beforeEach(() => {
        chamberStore.set({ activeInstanceId: null, instances: {} });
        registerChamberInstance(DEVICE_ID);
    });

    it('restores the saved algorithm, so the panel gates for the engine the project runs', () => {
        // The reload case. Wire value 6 is Reverse; without this the store said
        // Plate and every reverse-dead control rendered live.
        expect(engineState().algorithm).toBe('plate');

        seedProject({ algorithm: ALGORITHM_MAP.reverse });
        hydrateChamberStateFromProject(DEVICE_ID);

        expect(engineState().algorithm).toBe('reverse');
    });

    it('restores numeric and boolean parameters at the values the project holds', () => {
        seedProject({
            algorithm: ALGORITHM_MAP.spring,
            mix: 0.82,
            predelay: 137,
            width: 1.6,
            gravity: -0.4,
            shimmer: 1,
            freeze: 0,
        });

        hydrateChamberStateFromProject(DEVICE_ID);
        const restored = engineState();

        expect(restored.mix).toBe(0.82);
        expect(restored.predelay).toBe(137);
        expect(restored.width).toBe(1.6);
        expect(restored.gravity).toBe(-0.4);
        // Persisted as the 0/1 the engine reads, restored as booleans.
        expect(restored.shimmer).toBe(true);
        expect(restored.freeze).toBe(false);
    });

    it('leaves a parameter the project never stored at its default', () => {
        // Absence is the normal state for an untouched device and for any
        // project saved before a parameter was persisted; overwriting from a
        // partial record would invent values the user never chose.
        seedProject({ mix: 0.9 });
        hydrateChamberStateFromProject(DEVICE_ID);

        expect(engineState().mix).toBe(0.9);
        expect(engineState().density).toBe(DEFAULT_PARAMS.density);
        expect(engineState().algorithm).toBe(DEFAULT_PARAMS.algorithm);
    });

    it('ignores an algorithm wire value no engine dispatch claims', () => {
        // 4 and 5 are reserved for the convolution-backed engines that fall
        // through to the plate. A stored 4 must not become an algorithm id the
        // selector cannot draw, and must not gate against one either.
        seedProject({ algorithm: 4 });
        hydrateChamberStateFromProject(DEVICE_ID);

        expect(engineState().algorithm).toBe(DEFAULT_PARAMS.algorithm);
    });

    it('is idempotent', () => {
        seedProject({ algorithm: ALGORITHM_MAP['fdn-16'], mix: 0.55 });

        hydrateChamberStateFromProject(DEVICE_ID);
        const once = engineState();
        hydrateChamberStateFromProject(DEVICE_ID);

        expect(engineState()).toEqual(once);
    });

    it('covers every parameter the panel can write', () => {
        // The field lists are what the hydration iterates, and a parameter
        // missing from both would silently stop surviving a reload. Derived
        // from `PARAM_MAP` — the panel's own write table — rather than
        // enumerated, so a new parameter reds here instead of going quiet.
        const covered = new Set<string>([...NUMERIC_ENGINE_FIELDS, ...BOOLEAN_ENGINE_FIELDS, 'algorithm']);
        const writable = Object.keys(PARAM_MAP);

        expect(writable.filter((key) => !covered.has(key))).toEqual([]);
        expect([...covered].filter((key) => !writable.includes(key))).toEqual([]);
    });
});
