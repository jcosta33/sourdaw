import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../models/FermenterPatch';
import {
    fermenterStore as barrelFermenterStore,
    setFermenterTelemetry as barrelSetFermenterTelemetry,
} from '../index';
import {
    fermenterStore,
    getFermenterState,
    loadFermenterPatch,
    setFermenterParam,
    setFermenterTelemetry,
    setFermenterUiLevel,
} from '../fermenterStore';

async function flushPendingFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

describe('fermenterStore', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        fermenterStore.set({});
    });

    it('should return default state for a deviceId with no stored instance', () => {
        const state = getFermenterState('unknown-device');

        expect(state.patch).toEqual(DEFAULT_PATCH);
        expect(state.activeVoices).toBe(0);
        expect(state.engineReady).toBe(false);
        expect(state.uiLevel).toBe(2);
        expect(state.peakL).toBe(0);
        expect(state.peakR).toBe(0);
        expect(state.scopeBuffer).toBeNull();
    });

    it('should set a single patch param for a device without disturbing other devices', () => {
        setFermenterParam('device-a', 'filterCutoff', 1200);
        setFermenterParam('device-b', 'filterCutoff', 900);

        expect(getFermenterState('device-a').patch.filterCutoff).toBe(1200);
        expect(getFermenterState('device-b').patch.filterCutoff).toBe(900);
        // Untouched fields keep their default values.
        expect(getFermenterState('device-a').patch.filterResonance).toBe(DEFAULT_PATCH.filterResonance);
    });

    it('should accumulate multiple param writes onto the same device patch', () => {
        setFermenterParam('device-a', 'filterCutoff', 1200);
        setFermenterParam('device-a', 'masterGain', 0.5);

        const patch = getFermenterState('device-a').patch;
        expect(patch.filterCutoff).toBe(1200);
        expect(patch.masterGain).toBe(0.5);
    });

    it('should set the UI level for a device while preserving its patch', () => {
        setFermenterParam('device-a', 'filterCutoff', 1200);

        setFermenterUiLevel('device-a', 4);

        const state = getFermenterState('device-a');
        expect(state.uiLevel).toBe(4);
        expect(state.patch.filterCutoff).toBe(1200);
    });

    it('should replace the whole patch on load while preserving non-patch state', () => {
        setFermenterParam('device-a', 'filterCutoff', 1200);
        fermenterStore.set({
            ...(fermenterStore.value ?? {}),
            'device-a': { ...getFermenterState('device-a'), activeVoices: 3, engineReady: true },
        });

        loadFermenterPatch('device-a', { ...DEFAULT_PATCH, name: 'Loaded Patch', filterCutoff: 7000 });

        const state = getFermenterState('device-a');
        expect(state.patch.name).toBe('Loaded Patch');
        expect(state.patch.filterCutoff).toBe(7000);
        expect(state.activeVoices).toBe(3);
        expect(state.engineReady).toBe(true);
    });

    it('should batch telemetry updates and apply peak levels and scope buffer on the next frame', async () => {
        const scopeBuffer = new Float32Array([0.1, 0.2, 0.3]);

        setFermenterTelemetry('device-a', 0.6, 0.4, scopeBuffer);

        // Before the animation frame fires, the store has not been updated yet.
        expect(getFermenterState('device-a').peakL).toBe(0);

        await flushPendingFrame();

        const state = getFermenterState('device-a');
        expect(state.peakL).toBe(0.6);
        expect(state.peakR).toBe(0.4);
        expect(state.scopeBuffer).toBe(scopeBuffer);
    });

    it('should coalesce multiple telemetry writes for the same device into the latest values', async () => {
        setFermenterTelemetry('device-a', 0.1, 0.1, new Float32Array([0]));
        setFermenterTelemetry('device-a', 0.9, 0.8, new Float32Array([1]));

        await flushPendingFrame();

        const state = getFermenterState('device-a');
        expect(state.peakL).toBe(0.9);
        expect(state.peakR).toBe(0.8);
        expect(state.scopeBuffer).toEqual(new Float32Array([1]));
    });

    it('should apply queued telemetry independently per device', async () => {
        setFermenterTelemetry('device-a', 0.2, 0.3, new Float32Array([1]));
        setFermenterTelemetry('device-b', 0.7, 0.6, new Float32Array([2]));

        await flushPendingFrame();

        expect(getFermenterState('device-a').peakL).toBe(0.2);
        expect(getFermenterState('device-b').peakL).toBe(0.7);
    });

    it('should preserve the device patch when applying a telemetry update', async () => {
        setFermenterParam('device-a', 'filterCutoff', 3300);

        setFermenterTelemetry('device-a', 0.5, 0.5, new Float32Array([0.5]));
        await flushPendingFrame();

        expect(getFermenterState('device-a').patch.filterCutoff).toBe(3300);
    });

    it('should re-export the store and telemetry setter from the stores barrel', () => {
        expect(barrelFermenterStore).toBe(fermenterStore);
        expect(barrelSetFermenterTelemetry).toBe(setFermenterTelemetry);
    });
});
