import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';

import { crdtProjectCompactionState } from './crdtProjectCompactionState';

/**
 * Atomically replace persisted CRDT state with a full snapshot.
 * Called periodically and on explicit save.
 */
export async function compactProject(): Promise<void> {
    flushAutomergeStorageWrites();
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
    crdtProjectCompactionState.incrementalSaveCount = 0;
}
