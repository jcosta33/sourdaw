import { type ProofPatch } from '../models/ProofPatch';

export function isValidDynCrossoverFreqs([low, mid, high]: ProofPatch['dynCrossoverFreqs']): boolean {
    return (
        Number.isFinite(low) &&
        Number.isFinite(mid) &&
        Number.isFinite(high) &&
        low >= 20 &&
        high <= 20_000 &&
        low < mid &&
        mid < high
    );
}
