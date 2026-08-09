/**
 * The algorithms the selector offers, in the order it draws them.
 *
 * A tuple rather than a bare union so the ids can be *iterated* as well as
 * type-checked: `ALGORITHM_BY_WIRE_VALUE` inverts `ALGORITHM_MAP` over it
 * without a cast, and the panel numbers its badge by position in it.
 */
export const PROOF_CHAMBER_ALGORITHMS = ['plate', 'fdn-8', 'fdn-16', 'spring', 'reverse'] as const;

export type ProofChamberAlgorithm = (typeof PROOF_CHAMBER_ALGORITHMS)[number];

export type SpaceType = 'hall' | 'room' | 'plate' | 'chamber' | 'cathedral' | 'shimmer' | 'infinite' | 'spring';

export type ProofChamberEngineState = {
    algorithm: ProofChamberAlgorithm;
    space: SpaceType;
    mix: number;
    decay: number;
    damping: number;
    predelay: number;
    size: number;
    modRate: number;
    modDepth: number;
    diffusion: number;
    highCut: number;
    lowCut: number;
    width: number;
    freeze: boolean;
    shimmer: boolean;
    shimmerAmount: number;
    shimmerPitch: number; // 0=fifth, 1=octave
    gravity: number;
    saturation: boolean;
    /** Which saturation curve the plate runs: 0=tanh, 1=Chebyshev, 2=hard clip. */
    saturationType: number;
    earlyLateBalance: number;
    /** Cross-coupling between the plate's tank halves. 0=sparse, 1=dense. */
    density: number;
    vintage: number; // 0=modern, 1=80s, 2=70s
};

export const DEFAULT_PARAMS: ProofChamberEngineState = {
    algorithm: 'plate',
    space: 'hall',
    mix: 0.3,
    decay: 0.5,
    damping: 0.3,
    predelay: 15,
    size: 0.75,
    modRate: 1.0,
    modDepth: 0.3,
    diffusion: 0.75,
    highCut: 12000,
    lowCut: 80,
    width: 1.0,
    freeze: false,
    shimmer: false,
    shimmerAmount: 0.2,
    shimmerPitch: 1,
    gravity: 0.5,
    saturation: false,
    // Curve 0 is what every project has heard so far, because nothing could
    // write this parameter; the engine has always defaulted to it too.
    saturationType: 0,
    earlyLateBalance: 0.4,
    // Matches the plate's constructor, where `left_mod_ap_gain` starts at the
    // full -0.70 — i.e. density 1.0. A different default here would have moved
    // the shipped sound the moment the parameter became writable.
    density: 1.0,
    vintage: 0,
};

/**
 * The number each algorithm writes into the persisted `algorithm` parameter.
 *
 * These are a wire format: the value is stored in the project file and replayed
 * verbatim on load, and the engine dispatch in `crates/proof-chamber/src/lib.rs`
 * is the only thing that decides what each number means. They cannot be
 * renumbered without repointing values that are already stored.
 *
 * 4 and 5 are absent deliberately. They belong to the convolution and hybrid
 * engines, which are built and render but need an impulse response that nothing
 * in the app can supply, so the engine dispatch routes both to Plate. Reverse
 * keeps 6 rather than moving down into the gap they leave.
 */
export const ALGORITHM_MAP: Record<ProofChamberAlgorithm, number> = {
    plate: 0,
    'fdn-8': 1,
    'fdn-16': 2,
    spring: 3,
    reverse: 6,
};

/**
 * Whether the selected algorithm's engine converts the stored `decay`
 * coefficient into an RT60 through `#/utils/reverbDecayLaw`.
 *
 * Only the FDN engines do. The plate reads `decay` as a per-sample tank
 * feedback coefficient (`proof_chamber.rs`) and the spring as a delay-line
 * feedback gain clamped at 0.95 (`spring.rs`) — neither produces the tail the
 * RT60 law describes, so a readout must not print seconds for them.
 */
export function usesRt60DecayLaw(algorithm: ProofChamberAlgorithm): boolean {
    return algorithm === 'fdn-8' || algorithm === 'fdn-16';
}

export const SPACE_PRESETS: Record<SpaceType, Partial<ProofChamberEngineState>> = {
    hall: { size: 0.75, decay: 0.7, damping: 0.3, diffusion: 0.75, modDepth: 0.3, predelay: 20 },
    room: { size: 0.35, decay: 0.4, damping: 0.5, diffusion: 0.6, modDepth: 0.2, predelay: 5 },
    plate: { size: 0.5, decay: 0.6, damping: 0.15, diffusion: 0.85, modDepth: 0.5, predelay: 0 },
    chamber: { size: 0.45, decay: 0.5, damping: 0.4, diffusion: 0.7, modDepth: 0.25, predelay: 10 },
    cathedral: { size: 1.0, decay: 0.85, damping: 0.2, diffusion: 0.9, modDepth: 0.4, predelay: 40 },
    shimmer: {
        size: 0.8,
        decay: 0.75,
        damping: 0.1,
        diffusion: 0.8,
        modDepth: 0.5,
        shimmer: true,
        shimmerAmount: 0.3,
        predelay: 25,
    },
    infinite: { size: 0.6, decay: 0.999, damping: 0.0, diffusion: 0.75, modDepth: 0.0, freeze: true, predelay: 0 },
    spring: {
        algorithm: 'spring',
        size: 0.5,
        decay: 0.7,
        damping: 0.3,
        diffusion: 0.5,
        modDepth: 0.3,
        predelay: 0,
    },
};

/**
 * Expand a space preset into a full engine state: the module defaults, overlaid
 * with the space's tuning, with `space` pinned and `algorithm` resolved (the
 * space's own algorithm if it sets one, else the default). Single source of the
 * "expand a space into a full engine state" rule, shared by the live panel and
 * the factory-preset table so the two cannot drift.
 */
export function expandSpacePreset(space: SpaceType): ProofChamberEngineState {
    const preset = SPACE_PRESETS[space];
    return {
        ...DEFAULT_PARAMS,
        ...preset,
        space,
        algorithm: preset.algorithm ?? DEFAULT_PARAMS.algorithm,
    };
}

/** Map UI param name to Rust engine param name */
export const PARAM_MAP: Record<string, string> = {
    mix: 'mix',
    decay: 'decay',
    damping: 'damping',
    predelay: 'predelay',
    size: 'size',
    modRate: 'mod_rate',
    modDepth: 'mod_depth',
    diffusion: 'diffusion',
    highCut: 'high_cut',
    lowCut: 'low_cut',
    width: 'width',
    freeze: 'freeze',
    shimmer: 'shimmer',
    shimmerAmount: 'shimmer_amount',
    shimmerPitch: 'shimmer_pitch',
    gravity: 'gravity',
    saturation: 'saturation',
    saturationType: 'saturation_type',
    earlyLateBalance: 'early_late',
    density: 'density',
    algorithm: 'algorithm',
    vintage: 'vintage',
};

/**
 * The wire value each stored `algorithm` number means, inverted from
 * `ALGORITHM_MAP` rather than written out, so the two cannot disagree.
 *
 * Used on project open: `Device.parameterValues` holds the number, and the
 * panel needs the id back to draw the right selection — and, since #1519, to
 * gate the right controls.
 */
export const ALGORITHM_BY_WIRE_VALUE: Readonly<Record<number, ProofChamberAlgorithm>> = (() => {
    const inverted: Record<number, ProofChamberAlgorithm> = {};
    for (const algorithm of PROOF_CHAMBER_ALGORITHMS) {
        inverted[ALGORITHM_MAP[algorithm]] = algorithm;
    }
    return inverted;
})();

/**
 * The engine-state fields that round-trip through `Device.parameterValues`,
 * split by the type they carry back.
 *
 * Split rather than one list because the stored form is always a number: the
 * three switches persist as 0 or 1 and have to come back as booleans. Declared
 * as literal tuples so assignment stays type-checked, and asserted total
 * against `PARAM_MAP` by `hydrateChamberStateFromProject.spec.ts` — a new
 * parameter that never reaches one of these lists would silently stop
 * surviving a reload.
 */
export const NUMERIC_ENGINE_FIELDS = [
    'mix',
    'decay',
    'damping',
    'predelay',
    'size',
    'modRate',
    'modDepth',
    'diffusion',
    'highCut',
    'lowCut',
    'width',
    'shimmerAmount',
    'shimmerPitch',
    'gravity',
    'saturationType',
    'earlyLateBalance',
    'density',
    'vintage',
] as const satisfies readonly (keyof ProofChamberEngineState)[];

export const BOOLEAN_ENGINE_FIELDS = [
    'freeze',
    'shimmer',
    'saturation',
] as const satisfies readonly (keyof ProofChamberEngineState)[];

export type ProofChamberPluginState = {
    id: string;
    engineState: ProofChamberEngineState;
    uiLevel: 1 | 2 | 3 | 4 | 5; // Progressive disclosure level
    isBypassed: boolean;
};

export function createDefaultChamberState(id: string): ProofChamberPluginState {
    return {
        id,
        isBypassed: false,
        uiLevel: 1,
        engineState: { ...DEFAULT_PARAMS },
    };
}
