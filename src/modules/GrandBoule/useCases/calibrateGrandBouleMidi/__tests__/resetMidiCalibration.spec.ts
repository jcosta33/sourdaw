import { describe, it, expect, vi } from 'vitest';

import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, createDefaultGrandBouleState } from '../../../stores/grandBouleStore';
import { resetMidiCalibration } from '../resetMidiCalibration';
import { setCcSmoothingMs } from '../setCcSmoothingMs';
import { setSustainThreshold } from '../setSustainThreshold';

describe('resetMidiCalibration', () => {
    function makeStore() {
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.set(createDefaultGrandBouleState());
        return store;
    }

    it('restores every calibration value to its default', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const store = makeStore();
        setSustainThreshold({ engine, store, value: 0.5 });

        resetMidiCalibration({ engine, store });

        expect(store.value?.midiCalibration).toEqual(createDefaultMidiCalibration());
    });

    it('returns both engine-consumed values to their defaults in one call', () => {
        // Reset that only rewinds the knobs leaves the piano calibrated to the
        // values the readout no longer shows. Driven from 0.5 / 40 ms, not
        // from the defaults, so the reset has something to undo.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const store = makeStore();
        setSustainThreshold({ engine, store, value: 0.5 });
        setCcSmoothingMs({ engine, store, value: 40 });
        const setCalibration = vi.spyOn(engine, 'setCalibration');
        const defaults = createDefaultMidiCalibration();

        resetMidiCalibration({ engine, store });

        expect(setCalibration).toHaveBeenCalledExactlyOnceWith({
            sustainThreshold: defaults.sustainThreshold,
            ccSmoothingMs: defaults.ccSmoothingMs,
        });
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.clear();

        resetMidiCalibration({ engine, store });

        expect(store.value).toBeNull();
        expect(setCalibration).not.toHaveBeenCalled();
    });
});
