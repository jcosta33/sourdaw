/**
 * Per-pad parameter ids for the Toaster's scheduled-hit path (#4633).
 *
 * A sequencer step's parameter/sound locks are applied by the worklet inside
 * `process()`, on the audio render thread. The string-keyed `set_pad_param`
 * wasm-bindgen glue marshals the name into WASM linear memory via
 * `__wbindgen_malloc` — one heap allocation per locked parameter per hit — so
 * the wire message carries numeric ids instead and Rust's
 * `set_pad_param_by_id` (`crates/daw-dsp/src/toaster/engine.rs`) dispatches on
 * them. Ordinal agreement is the whole contract and no compiler checks it;
 * both sides pin it in tests (`wasm/__tests__/dawDspToasterPadParamIds.spec.ts`
 * against the shipped binary, `numeric_pad_setter_*` in the crate).
 *
 * Keys are the camelCase `PadState` names the producer
 * (`Toaster/useCases/sequencerPlayback.ts`) emits; `engineType` covers the
 * sound lock, including the worklet's post-hit restore write.
 *
 * Lives in `models/` for the same reason as `ToasterAutomationParams`:
 * `engine/ToasterNode` translates names to ids on the main thread and
 * `services/toasterProcessor.ts` — AudioWorklet code that may not import
 * `engine/` — reads the `engineType` id for the restore write.
 *
 * The table is a `Record`; consumers must not assume the ids stay dense
 * `0..n-1`. Membership (`Object.hasOwn`), not a key count, is the guard.
 */
export const TOASTER_PAD_PARAM_IDS: Readonly<Record<string, number>> = {
    volume: 0,
    pan: 1,
    muted: 2,
    soloed: 3,
    chokeGroup: 4,
    tune: 5,
    decay: 6,
    tone: 7,
    drive: 8,
    filterCutoff: 9,
    filterResonance: 10,
    sendReverb: 11,
    sendDelay: 12,
    transientAttack: 13,
    transientSustain: 14,
    busRoute: 15,
    engineType: 16,
};
