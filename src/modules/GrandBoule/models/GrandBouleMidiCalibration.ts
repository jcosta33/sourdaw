/**
 * MIDI controller calibration state for the Grand Boule piano.
 *
 * Defines per-instance calibration parameters that shape how raw MIDI input
 * is mapped to the physical-modelling engine's hammer/pedal dynamics.
 */

export type GrandBouleMidiCalibration = {
    /** Velocity curve power exponent. 0.5 = compressed, 1.0 = linear, 2.0 = expanded. */
    velocityCurveExponent: number;
    /** Minimum velocity output (floor). Range 0-0.5, default 0.0. */
    velocityFloor: number;
    /** Maximum velocity output (ceiling). Range 0.5-1.0, default 1.0. */
    velocityCeiling: number;
    /** CC message smoothing in milliseconds. Range 0-50, default 5. */
    ccSmoothingMs: number;
    /** Half-pedal engagement threshold for sustain CC. Range 0-0.5, default 0.15. */
    sustainThreshold: number;
};

export function createDefaultMidiCalibration(): GrandBouleMidiCalibration {
    return {
        velocityCurveExponent: 1.0,
        velocityFloor: 0.0,
        velocityCeiling: 1.0,
        ccSmoothingMs: 5,
        sustainThreshold: 0.15,
    };
}

/** Parameter range definitions used for clamping and UI display. */
export const MIDI_CALIBRATION_RANGES = {
    velocityCurveExponent: { min: 0.5, max: 2.0, step: 0.05, default: 1.0 },
    velocityFloor: { min: 0, max: 0.5, step: 0.01, default: 0.0 },
    velocityCeiling: { min: 0.5, max: 1.0, step: 0.01, default: 1.0 },
    ccSmoothingMs: { min: 0, max: 50, step: 1, default: 5 },
    sustainThreshold: { min: 0, max: 0.5, step: 0.01, default: 0.15 },
} as const;
