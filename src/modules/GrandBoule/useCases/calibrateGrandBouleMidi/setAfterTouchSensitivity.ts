import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

export const setAfterTouchSensitivity = (sensitivity: number): void => {
    const r = MIDI_CALIBRATION_RANGES.afterTouchSensitivity;
    updateCalibration({ afterTouchSensitivity: clamp(sensitivity, r.min, r.max) });
};