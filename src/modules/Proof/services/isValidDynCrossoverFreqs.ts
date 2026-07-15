import { PROOF_PATCH_RANGES, type ProofPatch } from '../models/ProofPatch';

export function isValidDynCrossoverFreqs([low, mid, high]: ProofPatch['dynCrossoverFreqs']): boolean {
    const [min, max] = PROOF_PATCH_RANGES.dynCrossoverFreq;
    return (
        Number.isFinite(low) &&
        Number.isFinite(mid) &&
        Number.isFinite(high) &&
        low >= min &&
        high <= max &&
        low < mid &&
        mid < high
    );
}
