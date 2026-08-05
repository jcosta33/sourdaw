import { type Store } from '#/infra/store/types';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

// --- Bulk operations --------------------------------------------------------

type ResetMidiCalibrationInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
};

export function resetMidiCalibration(input: ResetMidiCalibrationInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    const defaults = createDefaultMidiCalibration();
    input.store.set({
        ...state,
        midiCalibration: defaults,
    });
    // The other five calibration values are consumed in TypeScript at note
    // time; `sustainThreshold` lives in the DSP damper curve, so the reset has
    // to reach the engine or the knob snaps back while the piano does not.
    input.engine.setParam({ name: 'sustain_threshold', value: defaults.sustainThreshold });
}
