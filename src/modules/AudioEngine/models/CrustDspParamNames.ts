/**
 * The engine's own name for each Crust parameter a project authors.
 *
 * Crust is spelled twice on the way to the same DSP. A panel, a preset and an
 * automation lane all author the descriptor's camelCase id; `set_param`
 * (`crates/daw-dsp/src/crust/engine.rs`) matches snake_case and answers a name
 * it does not know by doing nothing. Two hosts hand that engine a name: the
 * worklet posts `set_param` through `services/crustProcessor.ts`, and the
 * native body hands the same name to the same engine through
 * `CrustBody::set_param` (`crates/daw-engine/src/scheduler.rs`). One table
 * serves both, so a strip that moves between the two runtimes cannot find one
 * parameter live and another one silent.
 *
 * The set is closed on purpose. `mapCrustParamToDspParam` answers `null` for an
 * id the limiter does not address, which is what lets a caller decide —
 * `readLiveAutomationWrites` drops such a lane rather than sending the engine a
 * write it would silently discard, and `projectPatch` drops such a key rather
 * than sending one `builtin_named_parameter`
 * (`crates/sourdaw-native/src/commands/graph.rs`) would refuse, taking the
 * whole chain mapping with it.
 *
 * `style` and `algorithm` both name the limiter's single algorithm slot —
 * `style` through `Algorithm::from_style_index` and `algorithm` through
 * `Algorithm::from_index` (`crates/daw-dsp/src/crust/params.rs`) — so a patch
 * carrying both settles on whichever lands last. Ordering that pair is not this
 * table's job: `BuiltinEffectType::patch_precedence` puts `style` first so the
 * exact pick wins.
 */
export const CRUST_DSP_PARAM_NAMES: Readonly<Record<string, string>> = {
    gain: 'gain',
    ceiling: 'ceiling',
    style: 'style',
    algorithm: 'algorithm',
    lookahead: 'lookahead',
    attack: 'attack',
    release: 'release',
    attackAuto: 'attack_auto',
    releaseAuto: 'release_auto',
    channelLinkTransient: 'channel_link_transient',
    channelLinkRelease: 'channel_link_release',
    truePeak: 'true_peak',
    oversampling: 'oversampling',
    satEnabled: 'sat_enabled',
    satAlgorithm: 'sat_algorithm',
    satDrive: 'sat_drive',
    satMix: 'sat_mix',
    deltaListen: 'delta_listen',
    unityGain: 'unity_gain',
    multiBand: 'multi_band',
    crossover1: 'crossover1',
    crossover2: 'crossover2',
    scHpfEnabled: 'sc_hpf_enabled',
    scHpfFreq: 'sc_hpf_freq',
    stereoMode: 'stereo_mode',
    dither: 'dither',
    outputBitDepth: 'output_bit_depth',
    bypass: 'bypass',
    resetTruePeak: 'reset_true_peak',
};

type MapCrustParamToDspParamInput = {
    paramId: string;
};

/** The engine's name for `paramId`, or `null` when Crust addresses no such parameter. */
export function mapCrustParamToDspParam(input: MapCrustParamToDspParamInput): string | null {
    return CRUST_DSP_PARAM_NAMES[input.paramId] ?? null;
}
