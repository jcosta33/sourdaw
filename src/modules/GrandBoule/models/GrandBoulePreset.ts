/**
 * A Grand Boule preset captures the per-instance sound-shaping parameters
 * that are exposed to the user but do not live in the DSP engine's per-key
 * physical tables.
 *
 * Presets are pure data — they do not own behavior and do not hold engine
 * handles. A preset is applied by pushing its parameter values through the
 * `setGrandBouleParam` use case.
 */

export type GrandBoulePresetParameters = {
    /** Hammer hardness offset (-1.0 .. +1.0, 0.0 = neutral). */
    hammerHardness: number;
    /** Velocity curve shaping exponent (0.5 .. 2.0, 1.0 = linear). */
    velocityCurve: number;
    /** Stereo width of the sampled stereo image (0.0 .. 1.0). */
    stereoWidth: number;
    /** Overall tone tilt: negative = darker, positive = brighter. */
    toneTilt: number;
};

export type GrandBoulePreset = {
    id: string;
    name: string;
    description: string;
    parameters: GrandBoulePresetParameters;
};

export function createNeutralPresetParameters(): GrandBoulePresetParameters {
    return {
        hammerHardness: 0.0,
        velocityCurve: 1.0,
        stereoWidth: 0.6,
        toneTilt: 0.0,
    };
}
