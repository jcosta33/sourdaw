/**
 * `DeviceParam::from_name` in `crates/daw-engine/src/timeline.rs`: the closed
 * set of names Knead's body resolves. Knead's own descriptor declares no
 * parameters, so this set — not the descriptor law — is what decides whether a
 * lane parameter id the engine will accept or refuse (one name it cannot
 * resolve fails the whole `write-device-parameter` batch). Declared in models
 * so any future Knead-side authoring site shares one spelling of the
 * vocabulary.
 */
export const KNEAD_ENGINE_PARAM_NAMES: ReadonlySet<string> = new Set([
    'shift_semitones',
    'retune_speed_ms',
    'formant_preserve',
]);
