import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { type CrdtDocumentSnapshot } from '../models/CrdtDocumentSnapshot';
import { automergeRepository } from '../repositories/automergeRepository';

type TransactSnapshotOutput = Promise<{
    before: CrdtDocumentSnapshot;
    after: CrdtDocumentSnapshot;
}>;

/**
 * Execute a mutating function and capture binary snapshots only for the
 * documents that were dirtied during its execution.
 */
export function transactSnapshot(callback: (transaction: object) => Promise<void>): TransactSnapshotOutput {
    return automergeRepository.transactSnapshot(async (transaction) => {
        try {
            await callback(transaction);
        } finally {
            flushAutomergeStorageWrites(transaction);
        }
    });
}
