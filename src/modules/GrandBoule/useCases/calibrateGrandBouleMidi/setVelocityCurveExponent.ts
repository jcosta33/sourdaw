import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

// --- Individual parameter setters -------------------------------------------

export const setVelocityCurveExponent = (exponent: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityCurveExponent;
    updateCalibration({ velocityCurveExponent: clamp(exponent, r.min, r.max) });
};