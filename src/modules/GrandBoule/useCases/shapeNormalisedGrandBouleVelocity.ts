import { clamp } from '#/utils/Math/clamp';

import { type GrandBouleMidiCalibration, createDefaultMidiCalibration } from '../models/GrandBouleMidiCalibration';

const FALLBACK_CALIBRATION = createDefaultMidiCalibration();

/** Shape a normalised velocity directly, without a lossy round-trip through MIDI's 7-bit range. */
export function shapeNormalisedGrandBouleVelocity(
    velocity: number,
    calibration: GrandBouleMidiCalibration = FALLBACK_CALIBRATION
): number {
    const normalised = clamp(velocity, 0, 1);
    const curved = normalised ** calibration.velocityCurveExponent;
    const { velocityFloor, velocityCeiling } = calibration;
    return velocityFloor + curved * (velocityCeiling - velocityFloor);
}
