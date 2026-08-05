import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './setMidiCalibrationParam';

type SetSustainThresholdInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    value: number;
};

/**
 * Calibrate the half-pedal engagement threshold for sustain (CC64).
 *
 * This is `threshold_low` of the damper curve `smoothstep(CC64, low, 0.85)`
 * (piano-plugin research §7.3), whose reference value is 0.15. Sustain pedals
 * differ in travel and rest position, so the engine takes the calibrated edge
 * rather than the reference constant: raise it and a pedal that rests part-way
 * down stops bleeding sustain; lower it and the dampers respond earlier.
 */
export function setSustainThreshold(input: SetSustainThresholdInput): void {
    setMidiCalibrationParam(input.store, 'sustainThreshold', input.value);
    // Forward what the store actually holds, so the engine cannot drift away
    // from the readout when the range clamp bites.
    const calibrated = input.store.value?.midiCalibration.sustainThreshold;
    if (calibrated === undefined) {
        return;
    }
    input.engine.setParam({ name: 'sustain_threshold', value: calibrated });
}
