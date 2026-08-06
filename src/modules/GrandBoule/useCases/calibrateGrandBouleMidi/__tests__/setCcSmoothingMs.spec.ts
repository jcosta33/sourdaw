import { describe, it, expect, vi } from 'vitest';

import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, createGrandBouleStore } from '../../../stores/grandBouleStore';
import { setCcSmoothingMs } from '../setCcSmoothingMs';

function makeStore() {
    const store = createGrandBouleStore(`cc-smooth-${Math.random()}`);
    store.set(createDefaultGrandBouleState());
    return store;
}

describe('setCcSmoothingMs', () => {
    it('stores the calibrated smoothing time', () => {
        const store = makeStore();

        setCcSmoothingMs({ engine: createDisconnectedGrandBouleEngineHandle(), store, value: 22 });

        expect(store.value?.midiCalibration.ccSmoothingMs).toBe(22);
    });

    it('dispatches the smoothing constant to the engine', () => {
        // A store write that never reaches the DSP leaves the knob inert: the
        // one-pole that turns stepped CC64 into a slide lives in the engine.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');

        setCcSmoothingMs({ engine, store: makeStore(), value: 22 });

        expect(setParam).toHaveBeenCalledWith({ name: 'cc_smoothing_ms', value: 22 });
    });

    it('dispatches the clamped value, not the requested one', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');
        const store = makeStore();

        // ccSmoothingMs maxes out at 50.
        setCcSmoothingMs({ engine, store, value: 900 });

        expect(store.value?.midiCalibration.ccSmoothingMs).toBe(50);
        expect(setParam).toHaveBeenCalledWith({ name: 'cc_smoothing_ms', value: 50 });
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');
        const store = createGrandBouleStore(`cc-smooth-empty-${Math.random()}`);
        store.clear();

        setCcSmoothingMs({ engine, store, value: 22 });

        expect(store.value).toBeNull();
        expect(setParam).not.toHaveBeenCalled();
    });
});
