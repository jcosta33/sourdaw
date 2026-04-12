import { clamp } from '#/utils/Math/clamp';

import {
    type GrandBouleMidiCalibration,
    MIDI_CALIBRATION_RANGES,
} from '../../models/GrandBouleMidiCalibration';
import { grandBouleStore } from '../../stores/grandBouleStore';

export { clamp };

export const updateCalibration = (patch: Partial<GrandBouleMidiCalibration>): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        midiCalibration: { ...state.midiCalibration, ...patch },
    });
};

/**
 * Generic setter for any MIDI calibration parameter.
 * Looks up the range from MIDI_CALIBRATION_RANGES and clamps the value.
 */
export const setMidiCalibrationParam = (
    key: keyof GrandBouleMidiCalibration,
    value: number,
): void => {
    const r = MIDI_CALIBRATION_RANGES[key];
    updateCalibration({ [key]: clamp(value, r.min, r.max) });
};