import { describe, it, expect, vi } from 'vitest';

import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, createDefaultGrandBouleState } from '../../../stores/grandBouleStore';
import { setSustainThreshold } from '../setSustainThreshold';

describe('setSustainThreshold', () => {
    function makeStore() {
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.set(createDefaultGrandBouleState());
        return store;
    }

    it('stores the calibrated half-pedal threshold', () => {
        const store = makeStore();

        setSustainThreshold({ engine: createDisconnectedGrandBouleEngineHandle(), store, value: 0.32 });

        expect(store.value?.midiCalibration.sustainThreshold).toBe(0.32);
    });

    it('dispatches the threshold to the engine damper curve', () => {
        // The whole point of the knob: `sustainThreshold` is `threshold_low`
        // of the DSP half-pedal smoothstep, so a store write that never
        // reaches the engine leaves the control inert. `ccSmoothingMs` rides
        // along at its untouched default (5 ms) because `setCalibration`
        // always carries both values.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');

        setSustainThreshold({ engine, store: makeStore(), value: 0.32 });

        expect(setCalibration).toHaveBeenCalledExactlyOnceWith({ sustainThreshold: 0.32, ccSmoothingMs: 5 });
    });

    it('dispatches the clamped value, not the requested one', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');
        const store = makeStore();

        // sustainThreshold maxes out at 0.5.
        setSustainThreshold({ engine, store, value: 9 });

        expect(store.value?.midiCalibration.sustainThreshold).toBe(0.5);
        expect(setCalibration).toHaveBeenCalledExactlyOnceWith({ sustainThreshold: 0.5, ccSmoothingMs: 5 });
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.clear();

        setSustainThreshold({ engine, store, value: 0.32 });

        expect(store.value).toBeNull();
        expect(setCalibration).not.toHaveBeenCalled();
    });
});
