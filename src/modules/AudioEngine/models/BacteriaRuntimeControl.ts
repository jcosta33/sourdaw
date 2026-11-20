import { BACTERIA_BAND_PARAMETER_IDS, BACTERIA_MAX_BANDS } from '#/utils/bacteriaParameterReplay';

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

const GENERATED_BAND_PARAMETER_IDS = Array.from({ length: BACTERIA_MAX_BANDS }, (_value, band) =>
    BACTERIA_BAND_PARAMETER_IDS.map((parameter) => `band${band}_${parameter}`)
).flat();

const BACTERIA_RUNTIME_PARAMETER_IDS = new Set<string>([
    ...GLOBAL_PARAMETER_IDS,
    ...BACTERIA_BAND_PARAMETER_IDS,
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

/** Admit only identifiers inside the fixed worklet namespace, including its capacity. */
export function isWithinBacteriaRuntimeParameterNamespace(parameterIds: readonly unknown[]): boolean {
    if (parameterIds.length > BACTERIA_RUNTIME_PARAMETER_IDS.size) {
        return false;
    }
    for (const parameterId of parameterIds) {
        if (typeof parameterId !== 'string' || !BACTERIA_RUNTIME_PARAMETER_IDS.has(parameterId)) {
            return false;
        }
    }
    return true;
}
