import { automergeRepository } from '../repositories/automergeRepository';
import { clearIncrementalsFromIdb } from '../repositories/crdtPersistence/clearIncrementalsFromIdb';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { crdtProjectCompactionState } from './crdtProjectCompactionState';

/**
 * Write a full snapshot and clear incremental chunks.
 * Called periodically and on explicit save.
 */
export async function compactProject(): Promise<void> {
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
    await clearIncrementalsFromIdb(DOC_PREFIX_ROOT);
    crdtProjectCompactionState.incrementalSaveCount = 0;
}
