import { automergeRepository } from '../repositories/automergeRepository';
import { saveIncrementalToIdb } from '../repositories/crdtPersistence/saveIncrementalToIdb';

import { compactProject } from './compactProject';
import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { CRDT_PROJECT_COMPACTION_THRESHOLD, crdtProjectCompactionState } from './crdtProjectCompactionState';

/**
 * Persist the current project incrementally.
 *
 * Uses `Automerge.saveIncremental()` which only serializes changes since
 * the last save - much faster than a full save for small edits.
 * Periodically compacts to a full snapshot for fast startup and bounded storage.
 */
export async function persistCrdtProject(): Promise<void> {
    const chunk = automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT);
    if (chunk && chunk.length > 0) {
        await saveIncrementalToIdb(DOC_PREFIX_ROOT, chunk);
        crdtProjectCompactionState.incrementalSaveCount++;
    }

    if (crdtProjectCompactionState.incrementalSaveCount >= CRDT_PROJECT_COMPACTION_THRESHOLD) {
        await compactProject();
    }
}
