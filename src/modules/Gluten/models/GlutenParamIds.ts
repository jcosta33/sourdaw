/**
 * The project-facing id for every Gluten parameter this module authors.
 *
 * A panel control, a preset loader and a hydration field all spell the
 * camelCase id the Arrangement descriptor declares; the engine answers to the
 * snake_case name `GLUTEN_DSP_PARAM_NAMES`
 * (`src/modules/AudioEngine/models/GlutenDspParamNames.ts`) maps that id to.
 * Models constants never cross module boundaries, so this file restates the
 * camelCase half of that weld for Gluten's own authoring sites — the panel, the
 * patch loader and the project hydration bridge — and `glutenParamIds.spec.ts`
 * pins the two key sets equal. An id added to one table without the other reds
 * there instead of surfacing later as a control that writes a parameter the
 * engine silently ignores (`set_param` answers a name it does not know by
 * doing nothing).
 *
 * Order mirrors `GLUTEN_DSP_PARAM_NAMES` so the parity spec's diff reads
 * line-for-line.
 */
export const GLUTEN_PARAM_IDS = {
    threshold: 'threshold',
    ratio: 'ratio',
    attack: 'attack',
    release: 'release',
    knee: 'knee',
    makeup: 'makeup',
    mix: 'mix',
    topology: 'topology',
    style: 'style',
    autoMakeup: 'autoMakeup',
    autoRelease: 'autoRelease',
    range: 'range',
    scHpfFreq: 'scHpfFreq',
    scHpfEnabled: 'scHpfEnabled',
    thrust: 'thrust',
    detection: 'detection',
    stereoMode: 'stereoMode',
    stereoLink: 'stereoLink',
    lookahead: 'lookahead',
    bypass: 'bypass',
    vcaCharacter: 'vcaCharacter',
    limitMode: 'limitMode',
    peakReduction: 'peakReduction',
    inputGain: 'inputGain',
    outputGain: 'outputGain',
    xfmrDrive: 'xfmrDrive',
    allButtons: 'allButtons',
    recovery: 'recovery',
    limiterThreshold: 'limiterThreshold',
    scLpfFreq: 'scLpfFreq',
    scLpfEnabled: 'scLpfEnabled',
    deltaListen: 'deltaListen',
    amount: 'amount',
    gainMatchBypass: 'gainMatchBypass',
    feedForward: 'feedForward',
    blendTopology: 'blendTopology',
    blendAmount: 'blendAmount',
    scEqFreq: 'scEqFreq',
    scEqGain: 'scEqGain',
    scEqQ: 'scEqQ',
    scEqEnabled: 'scEqEnabled',
    vcaType: 'vcaType',
    jfetK3: 'jfetK3',
    xfmrK2: 'xfmrK2',
    oversampling: 'oversampling',
    extSidechain: 'extSidechain',
} as const;

/** Any Gluten parameter id a panel, preset, or hydration site can author. */
export type GlutenParamId = keyof typeof GLUTEN_PARAM_IDS;
