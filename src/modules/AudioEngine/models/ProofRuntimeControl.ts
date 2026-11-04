import contract from '../services/proofAppliedParameterContract.json';

/** Exact wire projection of the versioned Rust applied-parameter registry. */
const parameters = new Map(contract.parameters.map((parameter) => [parameter.name, parameter]));
const parameterIds = Object.freeze(
    contract.parameters.filter((parameter) => parameter.live).map((parameter) => parameter.name)
);
const parameterIdSet = new Set<string>(parameterIds);
export const PROOF_RUNTIME_PARAMETER_COUNT = parameterIds.length;
export function createProofRuntimeParameterIds(): readonly string[] {
    return Object.freeze([...parameterIds]);
}
export function isProofRuntimeParameterId(value: unknown): value is string {
    return typeof value === 'string' && parameterIdSet.has(value);
}
export function isProofNativeParameterId(value: string): boolean {
    return value !== 'bypass' && parameters.has(value);
}

/** Preserve product bounds on the existing wire; auxiliary controls use DSP bounds. */
export function normalizeProofParameter(
    name: string,
    value: unknown,
    mode: 'live' | 'legacy' = 'legacy'
): number | null {
    const parameter = parameters.get(name);
    if (
        !parameter ||
        parameter.route === 'order' ||
        (mode === 'live' && !parameter.live) ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isFinite(Math.fround(value))
    ) {
        return null;
    }
    const minimum = parameter.live ? parameter.liveMinimum : parameter.minimum;
    const maximum = parameter.live ? parameter.liveMaximum : parameter.maximum;
    if (parameter.kind !== 'continuous' && !Number.isInteger(value)) {
        return null;
    }
    let normalized = value;
    if (parameter.kind === 'continuous' || parameter.clamp) {
        normalized = Math.max(minimum, Math.min(maximum, value));
    }
    if (
        normalized < minimum ||
        normalized > maximum ||
        (parameter.kind !== 'continuous' && !Number.isInteger(normalized))
    ) {
        return null;
    }
    return normalized;
}
