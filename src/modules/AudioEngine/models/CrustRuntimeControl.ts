/**
 * Crust's numeric worklet-wire namespace. This is a runtime safety schema, not
 * project truth: it admits only the finite keys the Crust bridge can emit
 * without importing that module's private patch model into AudioEngine.
 */
const CRUST_RUNTIME_PARAMETER_IDS = [
    'gain',
    'ceiling',
    'style',
    'algorithm',
    'lookahead',
    'attack',
    'release',
    'attackAuto',
    'releaseAuto',
    'channelLinkTransient',
    'channelLinkRelease',
    'truePeak',
    'oversampling',
    'satEnabled',
    'satAlgorithm',
    'satDrive',
    'satMix',
    'deltaListen',
    'unityGain',
    'multiBand',
    'crossover1',
    'crossover2',
    'scHpfEnabled',
    'scHpfFreq',
    'stereoMode',
    'dither',
    'outputBitDepth',
    'bypass',
    'resetTruePeak',
] as const;

const crustRuntimeParameterIdSet = new Set<string>(CRUST_RUNTIME_PARAMETER_IDS);

/** The adapter owns this finite schema; project parameter maps must not widen it. */
export function createCrustRuntimeParameterIds(): readonly string[] {
    return Object.freeze([...CRUST_RUNTIME_PARAMETER_IDS]);
}

export function isCrustRuntimeParameterId(value: unknown): value is string {
    return typeof value === 'string' && crustRuntimeParameterIdSet.has(value);
}

export const CRUST_RUNTIME_PARAMETER_COUNT = CRUST_RUNTIME_PARAMETER_IDS.length;
