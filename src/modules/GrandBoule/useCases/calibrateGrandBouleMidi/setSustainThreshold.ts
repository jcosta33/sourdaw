import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

export const setSustainThreshold = (threshold: number): void => {
    const r = MIDI_CALIBRATION_RANGES.sustainThreshold;
    updateCalibration({ sustainThreshold: clamp(threshold, r.min, r.max) });
};