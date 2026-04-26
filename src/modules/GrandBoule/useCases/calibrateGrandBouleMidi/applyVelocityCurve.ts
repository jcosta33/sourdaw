import { type GrandBouleMidiCalibration } from '../../models/GrandBouleMidiCalibration';

import { clamp } from './helpers';

/**
 * Apply a velocity through the current calibration curve.
 *
 * Useful for previewing how a raw MIDI velocity maps to the engine's
 * hammer force given the current floor/ceiling/exponent settings.
 */
export function applyVelocityCurve(rawVelocity: number, calibration: GrandBouleMidiCalibration): number {
    const normalised = clamp(rawVelocity / 127, 0, 1);
    const curved = normalised ** calibration.velocityCurveExponent;
    const { velocityFloor, velocityCeiling } = calibration;
    return velocityFloor + curved * (velocityCeiling - velocityFloor);
}
