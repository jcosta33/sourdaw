/**
 * Bacteria's numeric port-wire namespace. This is a runtime safety schema, not
 * project truth: it admits the finite keys the Bacteria bridge can emit without
 * importing that module's private patch model into AudioEngine.
 */
const GLOBAL_PARAMETER_IDS = [
    'mix',
    'inputGain',
    'outputGain',
    'bypass',
    'bandCount',
    'crossoverFreq1',
    'crossoverFreq2',
    'crossoverFreq3',
    'crossoverFreq4',
    'crossoverFreq5',
    'crossoverSlope',
    'crossoverMode',
    'globalRouting',
    'morphX',
    'morphY',
    'macro1',
    'macro2',
    'macro3',
    'macro4',
    'macro5',
    'macro6',
    'macro7',
    'macro8',
    'lfo1Rate',
    'lfo1Shape',
    'lfo1Sync',
    'lfo1Amount',
    'lfo2Rate',
    'lfo2Shape',
    'lfo2Sync',
    'lfo2Amount',
    'envFollowerAttack',
    'envFollowerRelease',
    'stepSeqSteps',
    'stepSeqRate',
    'lorenzSigma',
    'lorenzRho',
    'lorenzBeta',
    'lorenzSpeed',
] as const;

const BAND_PARAMETER_IDS = [
    'enabled',
    'solo',
    'mute',
    'gain',
    'oversampling',
    'distortionEnabled',
    'filterEnabled',
    'granularEnabled',
    'spectralEnabled',
    'modulationEnabled',
    'convolutionEnabled',
    'freqShiftEnabled',
    'chorusEnabled',
    'phaserEnabled',
    'lofiEnabled',
    'distortionMode',
    'drive',
    'asymmetry',
    'foldbackThreshold',
    'bitDepth',
    'sampleRateReduce',
    'tubeBias',
    'breakdownDepth',
    'filterMode',
    'filterCutoff',
    'filterResonance',
    'filterEnvAmount',
    'filterEnvAttack',
    'filterEnvRelease',
    'chorusRate',
    'chorusDepth',
    'chorusFeedback',
    'chorusMix',
    'phaserRate',
    'phaserDepth',
    'phaserFeedback',
    'phaserMix',
    'grainSize',
    'grainDensity',
    'grainPosOffset',
    'grainPitch',
    'grainWindow',
    'grainFreeze',
    'grainMix',
    'spectralBlur',
    'spectralFreeze',
    'spectralMix',
    'freqShiftHz',
    'freqShiftMix',
    'lofiAmount',
    'codecArtifact',
    'convolutionMix',
    'convolutionSeparation',
    'routingMode',
] as const;

const GENERATED_BAND_PARAMETER_IDS = Array.from({ length: 6 }, (_value, band) =>
    BAND_PARAMETER_IDS.map((parameter) => `band${band}_${parameter}`)
).flat();

const BACTERIA_RUNTIME_PARAMETER_IDS = new Set<string>([
    ...GLOBAL_PARAMETER_IDS,
    ...BAND_PARAMETER_IDS,
    ...GENERATED_BAND_PARAMETER_IDS,
]);

/**
 * The adapter owns this finite schema. Do not inherit a project parameter map:
 * project data is untrusted at the worklet boundary and must not widen the port
 * protocol.
 */
export function createBacteriaRuntimeParameterIds(): readonly string[] {
    return Object.freeze([...BACTERIA_RUNTIME_PARAMETER_IDS]);
}
