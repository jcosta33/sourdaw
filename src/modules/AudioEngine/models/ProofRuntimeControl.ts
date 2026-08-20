/** Finite Proof worklet wire namespace. It mirrors public producer names, not Proof models. */
const ids = [
    'bypass',
    'ab_bypass',
    'input_gain',
    'output_gain',
    'eq_bypass',
    'dyn_bypass',
    'img_bypass',
    'img_auto_mono_bass',
    'img_mono_bass_freq',
    'exc_bypass',
    'lim_bypass',
    'lim_ceiling',
    'lim_release',
    'lim_lookahead',
    'dither_mode',
    'dither_bits',
    'eq_linear_phase',
    ...Array.from({ length: 8 }, (_, i) => [
        `eq_band${i}_freq`,
        `eq_band${i}_gain`,
        `eq_band${i}_q`,
        `eq_band${i}_type`,
        `eq_band${i}_channel`,
        `eq_band${i}_enabled`,
    ]),
    ...Array.from({ length: 3 }, (_, i) => `dyn_xover${i}`),
    ...Array.from({ length: 4 }, (_, i) => [
        `dyn_band${i}_threshold`,
        `dyn_band${i}_ratio`,
        `dyn_band${i}_attack`,
        `dyn_band${i}_release`,
        `dyn_band${i}_knee`,
        `dyn_band${i}_makeup`,
        `dyn_band${i}_auto_makeup`,
        `dyn_band${i}_bypass`,
        `img_width${i}`,
        `exc_band${i}_type`,
        `exc_band${i}_drive`,
        `exc_band${i}_blend`,
        `exc_band${i}_enabled`,
    ]),
].flat();
const parameterIds = Object.freeze(ids);
const parameterIdSet = new Set<string>(parameterIds);
export const PROOF_RUNTIME_PARAMETER_COUNT = parameterIds.length;
export function createProofRuntimeParameterIds(): readonly string[] {
    return Object.freeze([...parameterIds]);
}
export function isProofRuntimeParameterId(value: unknown): value is string {
    return typeof value === 'string' && parameterIdSet.has(value);
}
