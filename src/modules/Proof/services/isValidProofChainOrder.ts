import { PROOF_PATCH_RANGES } from './proofPatchRanges';

export function isValidProofChainOrder(order: readonly number[]): boolean {
    const [min, max] = PROOF_PATCH_RANGES.chainModuleId;
    return (
        order.length === 5 &&
        order.every((moduleId) => Number.isInteger(moduleId) && moduleId >= min && moduleId <= max) &&
        new Set(order).size === 5
    );
}
