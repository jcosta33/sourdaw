/**
 * Gluten compressor patch — all parameter definitions and defaults.
 */

export type GlutenTopology = 'vca' | 'opto' | 'fet' | 'diode';

export type GlutenStyle = 'glue' | 'punch' | 'smooth' | 'pump';

/** Oversampling is a power-of-two factor; the engine only implements 1×, 2×, 4×. */
export type OversamplingFactor = 1 | 2 | 4;

export const OVERSAMPLING_FACTORS: readonly OversamplingFactor[] = [1, 2, 4];

/**
 * Resolve an arbitrary oversampling value onto a factor the engine builds
 * (1, 2, or 4), rounding **down**. A step-1 control over 1..4 can produce 3,
 * which has no stage behind it; this floors it to 2. Values are clamped into
 * the [1, 4] range first.
 *
 * This is the panel's copy of the law the Arrangement descriptor now declares
 * for every other surface (`GlutenDescriptor.ts` `legalSet`, resolution
 * `floor`) and that `ConfigurableOversample::set_rate` mirrors in Rust. The
 * three used to disagree: this floored 3 to 2, the descriptor declared 3 legal,
 * and the engine sent it up to 4x. `GlutenPatch.spec.ts` holds this and the
 * descriptor together; `DeviceLegalParameterValues.json` holds the descriptor
 * and the engine together.
 */
export function clampOversampling(value: number): OversamplingFactor {
    if (value <= 1) {
        return 1;
    }
    if (value >= 4) {
        return 4;
    }
    // 2 and 3 both resolve to 2 (3 snaps down to the supported 2× factor).
    return 2;
}

export type GlutenPatch = {
    name: string;

    // Core compressor
    topology: GlutenTopology;
    style: GlutenStyle;
    amount: number; // 0 – 100 (Level 1 macro: maps to threshold + ratio)
    threshold: number; // dB (-60 to 0)
    ratio: number; // 1:1 to 20:1
    attack: number; // ms (0.02 – 250)
    release: number; // ms (25 – 5000)
    knee: number; // dB (0 – 30)
    makeup: number; // dB (-12 to +24)
    mix: number; // 0 – 1
    autoMakeup: boolean;
    autoRelease: boolean;
    range: number; // dB (0 – 60, caps max GR)

    // Sidechain
    scHpfFreq: number; // Hz (20 – 500)
    scHpfEnabled: boolean;
    thrust: number; // 0 = off, 1 = medium, 2 = loud

    // Detection
    detection: 'rms' | 'peak';

    // Stereo
    stereoMode: 'stereo' | 'mid' | 'side' | 'dual-mono';
    stereoLink: number; // 0 – 1

    // Advanced
    oversampling: OversamplingFactor; // 1, 2, or 4
    lookahead: number; // ms (0 – 20)
    scLpfFreq: number; // Hz (1000 – 20000)
    scLpfEnabled: boolean;
    scEqFreq: number; // Hz (20 – 20000)
    scEqGain: number; // dB (-18 – +18)
    scEqQ: number; // 0.1 – 10
    scEqEnabled: boolean;
    deltaListen: boolean;
    gainMatchBypass: boolean;
    extSidechain: boolean;

    // FET-specific
    inputGain: number; // dB
    outputGain: number; // dB
    xfmrDrive: number; // 0 – 3
    allButtons: boolean;

    // Opto-specific
    limitMode: boolean;

    // Diode-specific
    recovery: number; // 1 – 5

    // VCA-specific
    vcaType: number; // 0 = Ideal, 1 = THAT 2181, 2 = DBX 202
    vcaCharacter: number; // 0 – 0.02
    feedForward: boolean; // VCA: false = feedback/SSL, true = feed-forward

    // FET harmonic controls
    jfetK3: number; // 0 – 0.5 (odd harmonic amount)
    xfmrK2: number; // 0 – 0.3 (even harmonic amount from transformer)

    // Dual-stage blend (Shadow Hills style)
    blendTopology: GlutenTopology;
    blendAmount: number; // 0 – 1 (0 = single, 1 = full dual-stage)
};

export const DEFAULT_PATCH: GlutenPatch = {
    name: 'Init',
    topology: 'vca',
    style: 'glue',
    amount: 50,
    threshold: -18,
    ratio: 4,
    attack: 10,
    release: 300,
    knee: 6,
    makeup: 0,
    mix: 1,
    autoMakeup: false,
    autoRelease: true,
    range: 15,
    scHpfFreq: 80,
    // Off, because a fresh device is a VCA and the detector filters only reach
    // the diode. Shipping the sidechain HPF *engaged* advertised a filter that
    // never ran; once the panel started gating the detector controls off Diode,
    // it also became the first thing a user is likely to click and the click
    // was swallowed. A default must not enable a stage its own topology cannot
    // run. `GlutenDescriptor`'s declared default moves with it.
    scHpfEnabled: false,
    thrust: 0,
    detection: 'rms',
    stereoMode: 'stereo',
    stereoLink: 1,
    // 1×, because a fresh device is a VCA and only the FET and diode stages are
    // oversampled. At 2× the panel drew the 2× chip lit and greyed — advertising
    // an oversampled path that does not run, with the click back to 1× refused —
    // and engaging a FET or Diode Stage two would have made a 2× nobody chose
    // real. The seven FET and Diode presets state `oversampling: 2` themselves
    // so none of them changes what it renders. `GlutenDescriptor`'s declared
    // default moves with this.
    oversampling: 1,
    lookahead: 0,
    scLpfFreq: 20000,
    scLpfEnabled: false,
    scEqFreq: 1000,
    scEqGain: 0,
    scEqQ: 1,
    scEqEnabled: false,
    deltaListen: false,
    gainMatchBypass: false,
    extSidechain: false,
    inputGain: 0,
    outputGain: 0,
    xfmrDrive: 1.2,
    allButtons: false,
    limitMode: false,
    recovery: 3,
    vcaType: 1,
    vcaCharacter: 0.003,
    feedForward: false,
    jfetK3: 0.15,
    xfmrK2: 0.0,
    blendTopology: 'opto',
    blendAmount: 0,
};
