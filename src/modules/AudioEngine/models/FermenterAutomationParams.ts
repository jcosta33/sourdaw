/**
 * Offline automation ordinals for the Fermenter. The scheduled path deliberately
 * bypasses the WASM string bridge: the worklet posts `{paramId, segments}` and
 * Rust indexes `AUTOMATION_PARAM_NAMES`
 * (`crates/daw-dsp/src/fermenter/mod.rs`) positionally.
 * The two sides use different spellings by design (`oscLevel`/`osc_level`,
 * `lfoPitchAmount`/`mod_lfo_to_pitch`), so their only contract is **ordinal
 * agreement**, and no compiler in either language checks it.
 *
 * **Every ordinal here is pinned**, by
 * `wasm/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`: it derives each
 * Rust name from the key beside it through `mapFermenterParamToDspParam` — the
 * same translation the live write path uses — and asserts that driving the
 * ordinal through the shipped wasm renders identically to driving that name.
 * Each row also asserts its probe actually moves the engine, so the comparison
 * cannot pass by both arms doing nothing. That spec also pins the table as
 * **dense 0..n-1**, which is what lets a consumer read its length as the
 * exclusive upper bound of the ordinal space.
 *
 * So this map may be edited freely, including inserting rather than appending:
 * a transposition fails that spec on both affected rows. What it must stay is
 * **dense 0..n-1** and **in step with `AUTOMATION_PARAM_NAMES`**
 * (`crates/daw-dsp/src/fermenter/mod.rs`); adding a key here needs the matching
 * Rust entry, a probe in that spec, and a wasm rebuild.
 *
 * ## Why this lives in `models/` and not next to `FermenterNode`
 *
 * Two layers need this table and they may not import each other: `engine/`
 * builds the `paramAutomation` message, and `services/fermenterProcessor.ts`
 * — AudioWorklet code, which `services-must-stay-pure` forbids from importing
 * `engine/` — must reject any ordinal Rust would silently ignore. When the
 * worklet restated that bound as its own literal `15`, adding `oscWaveform` at
 * ordinal 15 left the guard one short and every offline waveform automation
 * message was dropped before it reached the engine. A pure model both sides may
 * import is the only place that makes the count *derived* rather than restated.
 */
export const FERMENTER_AUTOMATION_PARAM_IDS: Readonly<Record<string, number>> = {
    oscLevel: 0,
    filterCutoff: 1,
    filterResonance: 2,
    lfoRate: 3,
    lfoFilterAmount: 4,
    lfoPitchAmount: 5,
    filterEnvAmount: 6,
    msegToFilter: 7,
    unisonSpread: 8,
    fmLevel2: 9,
    fmFeedback: 10,
    noiseLevel: 11,
    grainDensity: 12,
    grainSize: 13,
    grainSpray: 14,
    oscWaveform: 15,
};
