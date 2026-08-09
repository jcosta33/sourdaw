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
 *
 * ## Why 104 and not 105
 *
 * The Fermenter descriptor declares **105** automatable parameters. Every one is
 * here except one, and that exclusion is a measurement rather than a
 * preference: **the engine renders no difference between any two values of
 * it**, so a per-parameter guard for it could not fail, and a binding that
 * cannot be guarded is a claim with nothing behind it. It keeps a
 * reason-bearing row in `offlineAutomationExemptions.ts`.
 *
 *  - **`activeLayer`** writes no DSP state. `MasterSynth::set_param`
 *    (`crates/daw-dsp/src/fermenter/synth.rs`) reads it only to pick which layer
 *    *subsequent* parameter writes land on, and `note_on_with_channel` and
 *    `render_layers` both iterate `layers[..num_active_layers]` without
 *    consulting it. Binding it would additionally make every other lane's
 *    destination depend on the order the offline schedules happen to sit in
 *    `_paramAutomation`.
 *
 * ## Setter cost, measured rather than assumed
 *
 * PR #1394 measured the dispatch at ~26 ns per schedule per quantum, which sizes
 * the *loop* and says nothing about the work behind it. Measured through the
 * shipped `daw_dsp_bg.wasm` under V8 (min of 3 runs of 20k iterations,
 * alternating two values so no write is elided):
 *
 * ```text
 * osc_level          34.5 ns      eq_low_freq         37.7 ns
 * cutoff             25.1 ns      eq_mid_gain         85.2 ns
 * master_gain        35.2 ns      eq_high_q           35.1 ns
 * drift              25.2 ns      additive_inharm     41.3 ns
 * additive_odd    2 889.8 ns      additive_partials  3 146.7 ns
 * additive_tilt   4 106.4 ns
 * ```
 *
 * The EQ setters were the suspected expensive class and are not — `set_band`
 * recomputes one biquad. The real expensive class is `additive_tilt`,
 * `additive_odd` and `additive_partials`, which loop 16 voices and recompute 64
 * partial amplitudes per voice through `powf`/`log2`: 100-160x the cheap class.
 * Even so, the 102 that measurement covered moving in one quantum costs ~13.8 us
 * against the 2.667 ms budget (0.52%), and `_applyParamAutomation` skips a
 * schedule whose interpolated value has not changed, so a parked lane costs
 * nothing. Ordinals added since are plain field writes on `Layer`, which is the
 * cheap class above.
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
    oscEngine: 16,
    oscCoarse: 17,
    oscFine: 18,
    pulseWidth: 19,
    unisonVoices: 20,
    unisonDetune: 21,
    noiseColor: 22,
    oscDrift: 23,
    warpMode: 24,
    warpAmount: 25,
    audioModRate: 26,
    audioModDepth: 27,
    audioModTarget: 28,
    additivePartials: 29,
    additiveTilt: 30,
    additiveOdd: 31,
    additiveInharm: 32,
    ksDamping: 33,
    ksBrightness: 34,
    grainPosition: 35,
    grainPitchVar: 36,
    samplerMode: 37,
    samplerStart: 38,
    samplerEnd: 39,
    voiceDrive: 40,
    filterModel: 41,
    filterMode: 42,
    filterDrive: 43,
    filterKeytrack: 44,
    fmAlgorithm: 45,
    fmRatio1: 46,
    fmRatio2: 47,
    fmRatio3: 48,
    fmRatio4: 49,
    fmLevel1: 50,
    fmLevel3: 51,
    fmLevel4: 52,
    fmModAmount: 53,
    ampAttack: 54,
    ampDecay: 55,
    ampSustain: 56,
    ampRelease: 57,
    filterAttack: 58,
    filterDecay: 59,
    filterSustain: 60,
    filterRelease: 61,
    lfoShape: 62,
    seqRate: 63,
    seqToPitch: 64,
    portamentoTime: 65,
    reverbType: 66,
    reverbMix: 67,
    reverbDecay: 68,
    eqLowFreq: 69,
    eqLowGain: 70,
    eqLowQ: 71,
    eqMidFreq: 72,
    eqMidGain: 73,
    eqMidQ: 74,
    eqHighFreq: 75,
    eqHighGain: 76,
    eqHighQ: 77,
    delayTime: 78,
    delayFeedback: 79,
    delayMix: 80,
    chorusRate: 81,
    chorusDepth: 82,
    chorusMix: 83,
    phaserRate: 84,
    phaserDepth: 85,
    phaserMix: 86,
    distDrive: 87,
    distTone: 88,
    distMix: 89,
    compThreshold: 90,
    compRatio: 91,
    compAttack: 92,
    compRelease: 93,
    compMix: 94,
    stereoWidth: 95,
    numLayers: 96,
    layerLevel: 97,
    layerPan: 98,
    chaosAmount: 99,
    chaosSpeed: 100,
    masterGain: 101,
    portamentoMode: 102,
    grainPanSpread: 103,
};
