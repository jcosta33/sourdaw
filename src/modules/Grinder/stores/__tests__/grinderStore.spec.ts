import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PATCH, type GrinderPedal } from '../../models/GrinderPatch';
import {
    getGrinderState,
    grinderStore,
    loadGrinderPatch,
    moveGrinderPedalInChain,
    recallGrinderSnapshot,
    replaceGrinderPatchLocally,
    setGrinderMicParam,
    setGrinderParam,
    setGrinderPedalParam,
} from '../grinderStore';

describe('grinderStore', () => {
    const device_id = 'test-device';

    beforeEach(() => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    prePedals: [],
                },
                basePatch: {
                    ...DEFAULT_PATCH,
                    prePedals: [],
                },
            },
        });
    });

    it('should store pedal enabled state on the pedal instead of params.enabled', () => {
        const defaults: GrinderPedal = {
            id: 'od1',
            type: 'overdrive',
            enabled: false,
            params: { drive: 4.5, tone: 5.5, level: 6.8 },
        };

        setGrinderPedalParam(device_id, false, 'overdrive', 'enabled', 1, defaults);

        const pedal = getGrinderState(device_id).patch.prePedals.find((item) => item.type === 'overdrive');

        expect(pedal?.enabled).toBe(true);
        expect(pedal?.params.enabled).toBeUndefined();
    });

    it('should preserve gate and pedal enabled state when loading a patch', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            gateEnabled: true,
            prePedals: [
                {
                    id: 'od1',
                    type: 'overdrive',
                    enabled: true,
                    params: { drive: 4.5, tone: 5.5, level: 6.8 },
                },
            ],
        });

        const state = getGrinderState(device_id).patch;

        expect(state.gateEnabled).toBe(true);
        expect(state.prePedals[0]?.enabled).toBe(true);
    });

    it('should move supported pre pedals inside the stored chain order', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [
                {
                    id: 'od1',
                    type: 'overdrive',
                    enabled: true,
                    params: { drive: 4.5, tone: 5.5, level: 6.8 },
                },
                {
                    id: 'dist1',
                    type: 'distortion',
                    enabled: true,
                    params: { drive: 5.2, tone: 4.4, level: 7.2 },
                },
            ],
        });

        moveGrinderPedalInChain(device_id, false, 'distortion', 'left');

        const state = getGrinderState(device_id);

        expect(state.patch.prePedals.map((pedal) => pedal.type)).toEqual(['distortion', 'overdrive']);
        expect(state.basePatch.prePedals.map((pedal) => pedal.type)).toEqual(['distortion', 'overdrive']);
    });

    it('should recall snapshots from the stable base patch instead of accumulating prior snapshot state', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            gain: 5,
            prePedals: [
                {
                    id: 'od1',
                    type: 'overdrive',
                    enabled: false,
                    params: { drive: 2.8, tone: 5.2, level: 5.4 },
                },
            ],
            snapshots: [
                { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
                { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
            ],
        });

        recallGrinderSnapshot(device_id, 1);

        const drive_state = getGrinderState(device_id).patch;
        expect(drive_state.activeSnapshot).toBe(1);
        expect(drive_state.gain).toBe(7);
        expect(drive_state.prePedals[0]?.enabled).toBe(true);

        recallGrinderSnapshot(device_id, 0);

        const clean_state = getGrinderState(device_id).patch;
        expect(clean_state.activeSnapshot).toBe(0);
        expect(clean_state.gain).toBe(3);
        expect(clean_state.prePedals[0]?.enabled).toBe(false);
    });

    it('should keep the stable base patch intact when a param is edited during an active snapshot', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            master: 5,
            snapshots: [
                { id: 'a', name: 'A', paramOverrides: {}, bypassStates: {} },
                { id: 'b', name: 'B', paramOverrides: {}, bypassStates: {} },
            ],
        });

        // Activate snapshot B, edit a non-overridden param, then recall snapshot A.
        recallGrinderSnapshot(device_id, 1);
        setGrinderParam(device_id, 'master', 9);

        // The edit must not have leaked into the stable base.
        expect(getGrinderState(device_id).basePatch.master).toBe(5);

        recallGrinderSnapshot(device_id, 0);

        // Recalling another snapshot carries the original base value, not the edit.
        expect(getGrinderState(device_id).patch.master).toBe(5);
    });

    it('should apply numeric snapshot overrides without clobbering string-enum patch fields', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            engineMode: 'hybrid',
            gain: 5,
            snapshots: [
                {
                    id: 'scene',
                    name: 'Scene',
                    // engineMode is a string enum on the patch; a numeric override must not
                    // overwrite it with a raw number. gain is numeric and must apply.
                    paramOverrides: { gain: 8, engineMode: 2 },
                    bypassStates: {},
                },
            ],
        });

        const next = recallGrinderSnapshot(device_id, 0);

        expect(next?.gain).toBe(8);
        expect(next?.engineMode).toBe('hybrid');
        expect(typeof next?.engineMode).toBe('string');
    });

    it('moves a pedal right within the chain order', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [
                { id: 'od', type: 'overdrive', enabled: true, params: { drive: 1, tone: 1, level: 1 } },
                { id: 'dist', type: 'distortion', enabled: true, params: { drive: 1, tone: 1, level: 1 } },
            ],
        });
        moveGrinderPedalInChain(device_id, false, 'overdrive', 'right');
        expect(getGrinderState(device_id).patch.prePedals.map((p) => p.type)).toEqual(['distortion', 'overdrive']);
    });

    it('leaves the chain unchanged when moving left would cross only unsupported pedal types', () => {
        // wah is unsupported for chain moves; overdrive at index 0 can't move left.
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [
                { id: 'od', type: 'overdrive', enabled: true, params: { drive: 1, tone: 1, level: 1 } },
                { id: 'wah', type: 'wah', enabled: true, params: {} },
            ],
        });
        moveGrinderPedalInChain(device_id, false, 'overdrive', 'left');
        // overdrive is already first → no swap
        expect(getGrinderState(device_id).patch.prePedals.map((p) => p.type)).toEqual(['overdrive', 'wah']);
    });

    it('skips an unsupported pedal when moving right to find the next swappable one', () => {
        // overdrive(0), wah(1, unsupported), distortion(2): moving overdrive right
        // must skip wah and swap with distortion.
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [
                { id: 'od', type: 'overdrive', enabled: true, params: { drive: 1, tone: 1, level: 1 } },
                { id: 'wah', type: 'wah', enabled: true, params: {} },
                { id: 'dist', type: 'distortion', enabled: true, params: { drive: 1, tone: 1, level: 1 } },
            ],
        });
        moveGrinderPedalInChain(device_id, false, 'overdrive', 'right');
        expect(getGrinderState(device_id).patch.prePedals.map((p) => p.type)).toEqual([
            'distortion',
            'wah',
            'overdrive',
        ]);
    });

    it('returns null and leaves state unchanged when recalling a non-existent snapshot index', () => {
        loadGrinderPatch(device_id, { ...DEFAULT_PATCH, snapshots: [] });
        const before = getGrinderState(device_id).patch.activeSnapshot;
        const result = recallGrinderSnapshot(device_id, 99);
        expect(result).toBeNull();
        expect(getGrinderState(device_id).patch.activeSnapshot).toBe(before);
    });

    it('updates an existing pedal’s numeric param rather than appending a duplicate', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [{ id: 'od', type: 'overdrive', enabled: true, params: { drive: 1, tone: 5, level: 5 } }],
        });
        setGrinderPedalParam(device_id, false, 'overdrive', 'drive', 9, {
            id: 'od',
            type: 'overdrive',
            enabled: true,
            params: { drive: 1, tone: 5, level: 5 },
        });
        const pedals = getGrinderState(device_id).patch.prePedals;
        expect(pedals).toHaveLength(1); // no duplicate appended
        expect(pedals[0]?.params.drive).toBe(9);
    });

    it('sets a mic param on the targeted mic (mic2)', () => {
        loadGrinderPatch(device_id, { ...DEFAULT_PATCH });
        setGrinderMicParam(device_id, 2, 'gain', 3.5);
        expect(getGrinderState(device_id).patch.mic2.gain).toBe(3.5);
        // mic1 untouched
        expect(getGrinderState(device_id).patch.mic1.gain).not.toBe(3.5);
    });

    it('replaceGrinderPatchLocally overwrites the live patch and resets the base', () => {
        loadGrinderPatch(device_id, { ...DEFAULT_PATCH, gain: 3 });
        replaceGrinderPatchLocally(device_id, { ...DEFAULT_PATCH, gain: 9 });
        expect(getGrinderState(device_id).patch.gain).toBe(9);
        expect(getGrinderState(device_id).basePatch.gain).toBe(9);
    });

    it('returns a default state for an unknown device id', () => {
        const state = getGrinderState('never-loaded');
        // default state is produced via migrateGrinderPatch(DEFAULT_PATCH)
        expect(state.patch).toBeDefined();
        expect(state.basePatch).toBeDefined();
    });

    it('leaves the chain unchanged when moving a pedal type that is not present', () => {
        loadGrinderPatch(device_id, {
            ...DEFAULT_PATCH,
            prePedals: [{ id: 'od', type: 'overdrive', enabled: true, params: { drive: 1, tone: 1, level: 1 } }],
        });
        // fuzz is not in the chain → no-op, returns the (unchanged) patch
        const result = moveGrinderPedalInChain(device_id, false, 'fuzz', 'left');
        expect(result?.prePedals.map((p) => p.type)).toEqual(['overdrive']);
    });
});
