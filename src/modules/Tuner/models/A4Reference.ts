/**
 * The Scoring tuner's concert-A reference pitch.
 *
 * This is a *device parameter*, not panel state. `native-scoring` declares
 * `a4_hz` on its plugin descriptor, the worklet forwards it to
 * `ScoringInstance::set_param`, and `TuningSystem::a4_hz`
 * (`crates/scoring/src/tuning.rs`) is what every note name and cent deviation
 * the panel displays is measured against. It therefore lives in
 * `Device.parameterValues` like every other device parameter — one value the
 * engine and the panel both read — rather than in `tunerStore`, which carries
 * telemetry pushed *out* of the engine plus the display-mode preference, is
 * cleared by the project-open store reset, and is never read by the DSP.
 *
 * The four constants below restate what the descriptor declares. They are
 * welded to it in `__tests__/A4Reference.spec.ts`, which reads the
 * `native-scoring` entry out of the plugin registry rather than repeating it:
 * the descriptor is what `clampDeviceParameterValue` holds the write to, so a
 * knob sweeping a different span would offer values the write door silently
 * pins, and a different id would land on the engine's `_ => {}` arm.
 */

/** Descriptor parameter id; the engine matches on this exact string. */
export const A4_REFERENCE_PARAM_ID = 'a4_hz';

/** Reading used when the device carries no stored value yet. */
export const DEFAULT_A4_REFERENCE_HZ = 440;

export const MIN_A4_REFERENCE_HZ = 400;

export const MAX_A4_REFERENCE_HZ = 490;
