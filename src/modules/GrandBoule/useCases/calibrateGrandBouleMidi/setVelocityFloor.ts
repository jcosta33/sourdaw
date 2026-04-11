import { MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';
import { clamp, updateCalibration } from './helpers';

export const setVelocityFloor = (floor: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityFloor;
    updateCalibration({ velocityFloor: clamp(floor, r.min, r.max) });
};