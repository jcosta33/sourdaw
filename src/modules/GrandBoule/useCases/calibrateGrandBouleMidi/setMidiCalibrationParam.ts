import { type Store } from '#/infra/store/types';
import { clamp } from '#/utils/Math/clamp';

import { type GrandBouleMidiCalibration, MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleState } from '../../stores/grandBouleStore';

import { updateCalibration } from './helpers';

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
