import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';

const VALID_DENOMINATORS = [2, 4, 8, 16] as const;

export function setTimeSignature(numerator: number, denominator: number): void {
    // `numerator < 1 || numerator > 32` alone is false for NaN — both
    // comparisons are false against NaN — so a bad `parseInt` upstream would
    // otherwise reach the store and the undo inverse unrejected.
    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
        return;
    }
    if (!VALID_DENOMINATORS.includes(denominator as (typeof VALID_DENOMINATORS)[number])) {
        return;
    }

    const state = getTransportState();
    if (!state) {
        return;
    }

    updateTransportState({
        timeSignatureNumerator: numerator,
        timeSignatureDenominator: denominator,
    });
}
