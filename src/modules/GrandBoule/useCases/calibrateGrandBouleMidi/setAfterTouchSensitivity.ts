import { type Store } from '#/infra/store/types';

import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './setMidiCalibrationParam';

/**
 * Store-only, and knowingly so.
 *
 * The other five calibration values reach something: three shape velocity in
 * `applyVelocityCurve` at note time, two reach the DSP through
 * `syncMidiCalibrationToEngine`. This one has nothing to scale.
 * `GrandBouleEngine::note_expression` accepts `pressure` and drops it on
 * purpose — a struck string has no continuous pressure response, the engine
 * has no per-voice brightness control, and the device's expression registry
 * advertises pitch bend only. Multiplying a value the engine discards would
 * make the knob look wired without moving a sample.
 *
 * Making it real needs an aftertouch response in the piano model first, which
 * is a decision about what an acoustic piano should do with aftertouch, not a
 * wiring gap. Until that is taken, this writes the store and the readout, and
 * nothing downstream reads it.
 */
export function setAfterTouchSensitivity(input: { store: Store<GrandBouleState>; value: number }): void {
    setMidiCalibrationParam(input.store, 'afterTouchSensitivity', input.value);
}
