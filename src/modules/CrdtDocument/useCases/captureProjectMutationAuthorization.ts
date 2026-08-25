import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture an authorization check that rejects every project mutation except
 * those attributed to the exact storage transaction that first invokes it.
 *
 * The owner is bound lazily because confirmation admission runs once before
 * `executeAppActionBatch` creates its storage transaction. Until that owner is
 * visible, every mutation after capture is foreign. Once bound, the owner is
 * retained across handler awaits even though the ambient transaction is not.
 */
export function captureProjectMutationAuthorization(): () => boolean {
    const totalMutationBaseline = automergeRepository.getMutationEpoch();
    let boundOwner: object | undefined;
    let boundOwnerMutationBaseline = 0;

    return () => {
        const currentOwner = getCurrentAutomergeStorageMutationOwner();
        if (!boundOwner && currentOwner) {
            boundOwner = currentOwner;
            boundOwnerMutationBaseline = automergeRepository.getMutationEpochForOwner(currentOwner);
        }

        const totalMutations = automergeRepository.getMutationEpoch() - totalMutationBaseline;
        const boundOwnerMutations = boundOwner
            ? automergeRepository.getMutationEpochForOwner(boundOwner) - boundOwnerMutationBaseline
            : 0;
        return totalMutations === boundOwnerMutations;
    };
}
