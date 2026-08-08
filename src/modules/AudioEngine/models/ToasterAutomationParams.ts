/**
 * Offline automation ordinals for the Toaster. The scheduled path bypasses the
 * WASM string bridge: the worklet posts `{paramId, segments}` and Rust's
 * `set_param_by_id` (`crates/daw-dsp/src/toaster/`) dispatches on the ordinal,
 * so ordinal agreement is the whole contract and no compiler checks it.
 *
 * Every ordinal here is pinned against the shipped binary by
 * `wasm/__tests__/dawDspToasterAutomation.spec.ts`, which drives each id through
 * the real wasm and asserts the corresponding stage actually moves.
 *
 * ## Why this lives in `models/` and not next to `ToasterNode`
 *
 * Two layers need the table and they may not import each other: `engine/` builds
 * the `paramAutomation` message, and `services/toasterProcessor.ts` — AudioWorklet
 * code, which `services-must-stay-pure` forbids from importing `engine/` — must
 * reject any ordinal Rust would ignore. `models/` is the one layer both may read,
 * so the worklet's guard can be *derived* from this table rather than restate its
 * size. `ToasterNode` re-exports it, so existing consumers keep their import path.
 *
 * The table is a `Record`, so nothing about its shape forces the ordinals to be
 * dense `0..n-1`; consumers must not assume a key count is the ordinal bound.
 * The worklet guards on membership in the declared ordinal set instead, which is
 * correct whether or not a hole is ever introduced.
 */
export const TOASTER_AUTOMATION_PARAM_IDS: Readonly<Record<string, number>> = {
    masterGain: 0,
    reverbMix: 1,
    delayMix: 2,
};
