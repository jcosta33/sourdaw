/**
 * The engine's own name for each Gluten parameter a project authors.
 *
 * Gluten is spelled twice on the way to the same DSP. A panel, a preset and an
 * automation lane all author the descriptor's camelCase id; `set_param`
 * (`crates/daw-dsp/src/gluten/engine.rs`) matches snake_case and answers a name
 * it does not know by doing nothing. Two hosts hand that engine a name: the
 * worklet posts `set_param` through `services/glutenProcessor.ts`, and the
 * native body hands the same name to the same engine through
 * `GlutenBody::set_param` (`crates/daw-engine/src/scheduler.rs`). One table
 * serves both, so a strip that moves between the two runtimes cannot find one
 * parameter live and another one silent.
 *
 * The set is closed on purpose. `mapGlutenParamToDspParam` answers `null` for
 * an id the compressor does not address, which is what lets a caller decide —
 * `readLiveAutomationWrites` drops such a lane rather than sending the engine a
 * write it would silently discard, and `projectPatch` drops such a key rather
 * than sending one `builtin_named_parameter`
 * (`crates/sourdaw-native/src/commands/graph.rs`) would refuse, taking the
 * whole chain mapping with it.
 */
export const GLUTEN_DSP_PARAM_NAMES: Readonly<Record<string, string>> = {
    threshold: 'threshold',
    ratio: 'ratio',
    attack: 'attack',
    release: 'release',
    knee: 'knee',
    makeup: 'makeup',
    mix: 'mix',
    topology: 'topology',
    style: 'style',
    autoMakeup: 'auto_makeup',
    autoRelease: 'auto_release',
    range: 'range',
    scHpfFreq: 'sc_hpf_freq',
    scHpfEnabled: 'sc_hpf_enabled',
    thrust: 'thrust',
    detection: 'detection',
    stereoMode: 'stereo_mode',
    stereoLink: 'stereo_link',
    lookahead: 'lookahead',
    bypass: 'bypass',
    vcaCharacter: 'vca_character',
    limitMode: 'limit_mode',
    peakReduction: 'peak_reduction',
    inputGain: 'input_gain',
    outputGain: 'output_gain',
    xfmrDrive: 'xfmr_drive',
    allButtons: 'all_buttons',
    recovery: 'recovery',
    limiterThreshold: 'limiter_threshold',
    scLpfFreq: 'sc_lpf_freq',
    scLpfEnabled: 'sc_lpf_enabled',
    deltaListen: 'delta_listen',
    amount: 'amount',
    gainMatchBypass: 'gain_match_bypass',
    feedForward: 'feed_forward',
    blendTopology: 'blend_topology',
    blendAmount: 'blend_amount',
    scEqFreq: 'sc_eq_freq',
    scEqGain: 'sc_eq_gain',
    scEqQ: 'sc_eq_q',
    scEqEnabled: 'sc_eq_enabled',
    vcaType: 'vca_type',
    jfetK3: 'jfet_k3',
    xfmrK2: 'xfmr_k2',
    oversampling: 'oversampling',
    extSidechain: 'ext_sidechain',
};

type MapGlutenParamToDspParamInput = {
    paramId: string;
};

/** The engine's name for `paramId`, or `null` when Gluten addresses no such parameter. */
export function mapGlutenParamToDspParam(input: MapGlutenParamToDspParamInput): string | null {
    return GLUTEN_DSP_PARAM_NAMES[input.paramId] ?? null;
}
