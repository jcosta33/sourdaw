import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './setMidiCalibrationParam';
import { syncMidiCalibrationToEngine } from './syncMidiCalibrationToEngine';

type SetSustainThresholdInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    value: number;
};

/**
 * Calibrate the half-pedal engagement threshold for sustain (CC64).
 *
 * This is the lower edge of the damper curve `smoothstep(CC64, low, 0.85)`,
 * whose reference value is 0.15 — the pedal position at which the dampers
 * start to leave the strings. Sustain pedals differ in travel and rest
 * position, so the engine takes the calibrated edge rather than the reference
 * constant: raise it and a pedal that rests part-way down stops bleeding
 * sustain; lower it and the dampers respond earlier in the travel.
 *
 * Deliberately *not* the on/off point at which the engine considers the pedal
 * engaged for note-off catching. That one is the MIDI-standard 64/127 and is
 * not a per-controller calibration; this knob tops out at 0.5 and defaults to
 * 0.15, which is the half-pedal edge and nothing else.
 */
export function setSustainThreshold(input: SetSustainThresholdInput): void {
    setMidiCalibrationParam(input.store, 'sustainThreshold', input.value);
    syncMidiCalibrationToEngine({ engine: input.engine, store: input.store });
}
