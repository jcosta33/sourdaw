import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';

/**
 * A clause that only adds one more reference and its decibel figure to the level change before it:
 * "and the Snare at -9 dB". The figure's connector states its form, and the action must declare it.
 */
export function isLevelContinuationClause(
    maskedClause: string,
    decibelLevelForms: readonly ('absolute-decibel' | 'relative-decibel')[]
): boolean {
    if (
        !/^\s*(?:(?:the|a|an)\s+)?(?:clip)?□+\s+(?:at|to|by|up|down)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*d\s?b\s*$/iu.test(
            maskedClause
        )
    ) {
        return false;
    }
    const statedLevelForms = getStatedDecibelLevelForms(maskedClause);
    return decibelLevelForms.some((form) => statedLevelForms.has(form));
}
