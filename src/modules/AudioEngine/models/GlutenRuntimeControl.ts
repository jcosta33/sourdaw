/** Finite numeric Gluten worklet-wire namespace; it is runtime safety, not project truth. */
const GLUTEN_RUNTIME_PARAMETER_IDS = [
    'threshold',
    'ratio',
    'attack',
    'release',
    'makeup',
    'mix',
    'topology',
    'style',
    'autoMakeup',
    'autoRelease',
    'range',
    'scHpfFreq',
    'scHpfEnabled',
    'thrust',
    'detection',
    'stereoMode',
    'stereoLink',
    'lookahead',
    'bypass',
    'vcaCharacter',
    'limitMode',
    'peakReduction',
    'inputGain',
    'outputGain',
    'xfmrDrive',
    'allButtons',
    'recovery',
    'limiterThreshold',
    'scLpfFreq',
    'scLpfEnabled',
    'deltaListen',
    'amount',
    'gainMatchBypass',
    'feedForward',
    'blendTopology',
    'blendAmount',
    'scEqFreq',
    'scEqGain',
    'scEqQ',
    'scEqEnabled',
    'vcaType',
    'jfetK3',
    'xfmrK2',
    'oversampling',
    'extSidechain',
] as const;

const glutenRuntimeParameterIdSet = new Set<string>(GLUTEN_RUNTIME_PARAMETER_IDS);

export function createGlutenRuntimeParameterIds(): readonly string[] {
    return Object.freeze([...GLUTEN_RUNTIME_PARAMETER_IDS]);
}

export function isGlutenRuntimeParameterId(value: unknown): value is string {
    return typeof value === 'string' && glutenRuntimeParameterIdSet.has(value);
}

export const GLUTEN_RUNTIME_PARAMETER_COUNT = GLUTEN_RUNTIME_PARAMETER_IDS.length;
