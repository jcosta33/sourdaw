import { automergeRepository } from '../repositories/automergeRepository';

import { type DocumentBundle } from './crdtDocumentTypes';

type TransactSnapshotOutput = Promise<{
    before: DocumentBundle;
    after: DocumentBundle;
}>;

/**
 * Execute a mutating function and capture binary snapshots only for the
 * documents that were dirtied during its execution.
 */
export function transactSnapshot(callback: () => Promise<void>): TransactSnapshotOutput {
    return automergeRepository.transactSnapshot(callback);
}
