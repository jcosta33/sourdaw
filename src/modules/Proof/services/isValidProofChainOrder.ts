import { PROOF_PATCH_RANGES } from '../models/ProofPatch';

export function isValidProofChainOrder(order: readonly number[]): boolean {
    const [min, max] = PROOF_PATCH_RANGES.chainModuleId;
    if (order.length !== 5) {
        return false;
    }

    const moduleIds = new Set<number>();
    for (let index = 0; index < order.length; index++) {
        const moduleId = order[index];
        if (
            typeof moduleId !== 'number' ||
            !Number.isInteger(moduleId) ||
            moduleId < min ||
            moduleId > max ||
            moduleIds.has(moduleId)
        ) {
            return false;
        }
        moduleIds.add(moduleId);
    }
    return true;
}
