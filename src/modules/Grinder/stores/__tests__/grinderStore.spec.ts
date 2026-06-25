import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PATCH, type GrinderPedal } from '../../models/GrinderPatch';
import {
    getGrinderState,
    grinderStore,
    loadGrinderPatch,
    moveGrinderPedalInChain,
    recallGrinderSnapshot,
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
                    paramOverrides: { gain: 8, engineMode: 2 as unknown as number },
                    bypassStates: {},
                },
            ],
        });

        const next = recallGrinderSnapshot(device_id, 0);

        expect(next?.gain).toBe(8);
        expect(next?.engineMode).toBe('hybrid');
        expect(typeof next?.engineMode).toBe('string');
    });
});
