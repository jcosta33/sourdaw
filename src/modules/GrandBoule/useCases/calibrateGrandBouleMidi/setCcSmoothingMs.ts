import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

export const setCcSmoothingMs = (ms: number): void => {
    const r = MIDI_CALIBRATION_RANGES.ccSmoothingMs;
    updateCalibration({ ccSmoothingMs: clamp(ms, r.min, r.max) });
};