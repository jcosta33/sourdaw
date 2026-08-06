import { type Store } from '#/infra/store/types';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

import { syncMidiCalibrationToEngine } from './syncMidiCalibrationToEngine';

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
    input.store.set({
        ...state,
        midiCalibration: createDefaultMidiCalibration(),
    });
    // Four of the six values are consumed in TypeScript at note time; the two
    // pedal-shaping ones live in the DSP, so the reset has to reach the engine
    // or the knobs snap back while the piano stays calibrated to the values
    // the readout no longer shows.
    syncMidiCalibrationToEngine({ engine: input.engine, store: input.store });
}
