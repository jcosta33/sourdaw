import { type GrandBouleMidiCalibration } from '../models/GrandBouleMidiCalibration';

/**
 * Pure velocity-curve math. Colocated with `grandBouleStore` (whose state
 * carries `midiCalibration`) so AudioEngine's realtime MIDI handlers can
 * apply the curve without importing `GrandBoule/useCases` — that import
 * reaches back through `applyVelocityCurve`'s original home and re-forms the
 * `AudioEngine ↔ GrandBoule` barrel cycle.
 */
export function applyVelocityCurve(rawVelocity: number, calibration: GrandBouleMidiCalibration): number {
    const normalised = Math.max(0, Math.min(1, rawVelocity / 127));
    const curved = normalised ** calibration.velocityCurveExponent;
    const { velocityFloor, velocityCeiling } = calibration;
    return velocityFloor + curved * (velocityCeiling - velocityFloor);
}
