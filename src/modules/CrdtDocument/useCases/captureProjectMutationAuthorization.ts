import {
    getCurrentAutomergeStorageMutationOwner,
    hasForeignPendingAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture an authorization check that rejects every project mutation except
 * those attributed to the exact storage transaction that first invokes it.
 *
 * The owner is bound lazily because confirmation admission runs once before
 * `executeAppActionBatch` creates its storage transaction. Until that owner is
 * visible, every mutation after capture is foreign. Once bound, the owner is
 * retained across handler awaits even though the ambient transaction is not.
 * Pending-write refusal is opt-in; those checks must re-enter the owner's
 * storage scope so its own buffered writes are not mistaken for foreign ones.
 */
export function captureProjectMutationAuthorization(options?: { rejectForeignPendingWrites: true }): () => boolean {
    const totalMutationBaseline = automergeRepository.getMutationEpoch();
    const rejectForeignPendingWrites = options?.rejectForeignPendingWrites === true;
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
        return (
            totalMutations === boundOwnerMutations &&
            (!rejectForeignPendingWrites ||
                !automergeRepository.getDocIds().some(hasForeignPendingAutomergeStorageWrites))
        );
    };
}
