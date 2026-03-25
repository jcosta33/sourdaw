import { transportStore } from '../stores/transportStore';

const VALID_DENOMINATORS = [2, 4, 8, 16] as const;

export function setTimeSignature(numerator: number, denominator: number): void {
    if (numerator < 1 || numerator > 32) {
        return;
    }
    if (!VALID_DENOMINATORS.includes(denominator as (typeof VALID_DENOMINATORS)[number])) {
        return;
    }

    const state = transportStore.value;
    if (!state) {
        return;
    }

    transportStore.set({
        ...state,
        timeSignatureNumerator: numerator,
        timeSignatureDenominator: denominator,
    });
}
