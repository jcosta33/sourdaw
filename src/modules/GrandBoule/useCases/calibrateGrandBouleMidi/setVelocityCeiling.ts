import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

export const setVelocityCeiling = (ceiling: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityCeiling;
    updateCalibration({ velocityCeiling: clamp(ceiling, r.min, r.max) });
};