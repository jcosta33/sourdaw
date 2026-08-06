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

    it('returns both engine-consumed values to their defaults', () => {
        // Reset that only rewinds the knobs leaves the piano calibrated to the
        // values the readout no longer shows. Driven from 0.5 / 40 ms, not
        // from the defaults, so the reset has something to undo.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const store = makeStore();
        setSustainThreshold({ engine, store, value: 0.5 });
        setCcSmoothingMs({ engine, store, value: 40 });
        const setParam = vi.spyOn(engine, 'setParam');
        const defaults = createDefaultMidiCalibration();

        resetMidiCalibration({ engine, store });

        expect(setParam).toHaveBeenCalledWith({
            name: 'sustain_threshold',
            value: defaults.sustainThreshold,
        });
        expect(setParam).toHaveBeenCalledWith({
            name: 'cc_smoothing_ms',
            value: defaults.ccSmoothingMs,
        });
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.clear();

        resetMidiCalibration({ engine, store });

        expect(store.value).toBeNull();
        expect(setParam).not.toHaveBeenCalled();
    });
});
