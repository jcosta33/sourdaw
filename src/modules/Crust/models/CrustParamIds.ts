/**
 * The project-facing id for every Crust parameter this module authors.
 *
 * A panel control, a preset loader and a hydration field all spell the
 * camelCase id the Arrangement descriptor declares; the engine answers to the
 * snake_case name `CRUST_DSP_PARAM_NAMES`
 * (`src/modules/AudioEngine/models/CrustDspParamNames.ts`) maps that id to.
 * Models constants never cross module boundaries, so this file restates the
 * camelCase half of that weld for Crust's own authoring sites — the panel, the
 * control zone, the patch loader and the project hydration bridge — and
 * `crustParamIds.spec.ts` pins the relationship: every id the engine
 * translation table knows is spelled here exactly once, and the only extras are
 * the store-only keys named in that spec. An id drifting between the two reds
 * there instead of surfacing later as a control that writes a parameter the
 * engine silently ignores (`set_param` answers a name it does not know by
 * doing nothing).
 *
 * Order mirrors `CRUST_DSP_PARAM_NAMES` so the parity spec's diff reads
 * line-for-line; the store-only ids follow at the end.
 */
export const CRUST_PARAM_IDS = {
    gain: 'gain',
    ceiling: 'ceiling',
    style: 'style',
    algorithm: 'algorithm',
    lookahead: 'lookahead',
    attack: 'attack',
    release: 'release',
    attackAuto: 'attackAuto',
    releaseAuto: 'releaseAuto',
    channelLinkTransient: 'channelLinkTransient',
    channelLinkRelease: 'channelLinkRelease',
    truePeak: 'truePeak',
    oversampling: 'oversampling',
    satEnabled: 'satEnabled',
    satAlgorithm: 'satAlgorithm',
    satDrive: 'satDrive',
    satMix: 'satMix',
    deltaListen: 'deltaListen',
    unityGain: 'unityGain',
    multiBand: 'multiBand',
    crossover1: 'crossover1',
    crossover2: 'crossover2',
    scHpfEnabled: 'scHpfEnabled',
    scHpfFreq: 'scHpfFreq',
    stereoMode: 'stereoMode',
    dither: 'dither',
    outputBitDepth: 'outputBitDepth',
    bypass: 'bypass',
    resetTruePeak: 'resetTruePeak',
    /** Store-only: persists the loudness-target menu choice; no engine encoding exists. */
    streamingPreset: 'streamingPreset',
} as const;

/** Any Crust parameter id a panel, preset, or hydration site can author. */
export type CrustParamId = keyof typeof CRUST_PARAM_IDS;
