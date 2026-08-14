import { runWithAutomergeStorageTransaction } from '#/infra/store/storage/createAutomergeStorage';

import { recordProjectCommandBatchIdempotencyCheckpoint } from './recordProjectCommandBatchIdempotencyCheckpoint';

type PersistProjectCommandBatchIdempotencyCheckpointInput = Parameters<
    typeof recordProjectCommandBatchIdempotencyCheckpoint
>[0];

export function persistProjectCommandBatchIdempotencyCheckpoint(
    input: PersistProjectCommandBatchIdempotencyCheckpointInput
): void {
    const transaction = runWithAutomergeStorageTransaction(undefined, (scope) =>
        scope(() => recordProjectCommandBatchIdempotencyCheckpoint(input))
    );
    if (transaction.status === 'threw') {
        transaction.abort();
        throw transaction.error;
    }
    try {
        transaction.commit();
    } catch (error) {
        transaction.abort();
        throw error;
    }
}
