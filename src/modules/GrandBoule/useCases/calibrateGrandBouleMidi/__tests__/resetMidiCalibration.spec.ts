import { describe, it, expect, vi } from 'vitest';

import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, createDefaultGrandBouleState } from '../../../stores/grandBouleStore';
import { resetMidiCalibration } from '../resetMidiCalibration';
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

    it('returns the engine damper curve to the default threshold', () => {
        // Reset that only rewinds the knob leaves the piano calibrated to the
        // value the readout no longer shows.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const store = makeStore();
        setSustainThreshold({ engine, store, value: 0.5 });
        const setParam = vi.spyOn(engine, 'setParam');

        resetMidiCalibration({ engine, store });

        expect(setParam).toHaveBeenCalledWith({
            name: 'sustain_threshold',
            value: createDefaultMidiCalibration().sustainThreshold,
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
