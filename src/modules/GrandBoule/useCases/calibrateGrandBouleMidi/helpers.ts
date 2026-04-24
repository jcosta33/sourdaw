import { type Store } from '#/infra/store/types';
import { clamp } from '#/utils/Math/clamp';

import { type GrandBouleMidiCalibration, MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleState } from '../../stores/grandBouleStore';

export { clamp };

export function updateCalibration(store: Store<GrandBouleState>, patch: Partial<GrandBouleMidiCalibration>): void {
    const state = store.value;
    if (state === null) {
        return;
    }
    store.set({
        ...state,
        midiCalibration: { ...state.midiCalibration, ...patch },
    });
}

/**
 * Generic setter for any MIDI calibration parameter.
 * Looks up the range from MIDI_CALIBRATION_RANGES and clamps the value.
 */
export function setMidiCalibrationParam(
    store: Store<GrandBouleState>,
    key: keyof GrandBouleMidiCalibration,
    value: number
): void {
    const range = MIDI_CALIBRATION_RANGES[key];
    updateCalibration(store, { [key]: clamp(value, range.min, range.max) });
}
