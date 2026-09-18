/**
 * The DSP's own names for the two MIDI calibration values it consumes.
 *
 * `sustainThreshold` and `ccSmoothingMs` are not project-authored descriptor
 * ids — they never appear in `GrandBouleDspParamNames.ts` — because
 * `GrandBouleMidiCalibration` is calibration state, not a preset parameter.
 * Both the live engine handle (`resolveGrandBouleEngine.ts`, mirroring a
 * calibration write onto the natively carried body the moment it is set) and
 * the build-time projection (`projectGrandBouleCalibrationToNativePatch.ts`,
 * folding a calibrated store into a freshly built native body) address the
 * same two `set_param` arms
 * (`crates/daw-dsp/src/grand_boule/engine.rs:580,583`), so one constant is
 * what keeps the two doors from spelling the DSP's vocabulary twice and
 * drifting apart.
 */
export const GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES = {
    sustainThreshold: 'sustain_threshold',
    ccSmoothingMs: 'cc_smoothing_ms',
} as const;
