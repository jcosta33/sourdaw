import { runWithAutomergeStorageTransaction } from '#/infra/store/storage/createAutomergeStorage';

import { recordProjectCommandBatchIdempotencyCheckpoint } from './recordProjectCommandBatchIdempotencyCheckpoint';

type PersistProjectCommandBatchIdempotencyCheckpointInput = Parameters<
    typeof recordProjectCommandBatchIdempotencyCheckpoint
>[0] & {
    validateCommit?: () => string | null;
};

export function persistProjectCommandBatchIdempotencyCheckpoint(
    input: PersistProjectCommandBatchIdempotencyCheckpointInput
): void {
    const { validateCommit, ...checkpoint } = input;
    const transaction = runWithAutomergeStorageTransaction(undefined, (scope) =>
        scope(() => recordProjectCommandBatchIdempotencyCheckpoint(checkpoint))
    );
    if (transaction.status === 'threw') {
        transaction.abort();
        throw transaction.error;
    }
    if (validateCommit) {
        transaction.validateCommit(validateCommit);
    }
    try {
        transaction.commit();
    } catch (error) {
        transaction.abort();
        throw error;
    }
}
