import { logger } from '#/infra/logger/appLogger';

import { automergeRepository } from '../repositories/automergeRepository';
import { clearIncrementalsFromIdb } from '../repositories/crdtPersistence/clearIncrementalsFromIdb';
import { hasCrdtDocsInIdb } from '../repositories/crdtPersistence/hasCrdtDocsInIdb';
import { loadAllFromIdb } from '../repositories/crdtPersistence/loadAllFromIdb';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import { saveIncrementalToIdb } from '../repositories/crdtPersistence/saveIncrementalToIdb';
import { isNativeCrdtAvailable } from '../repositories/nativeCrdtPersistence/isNativeCrdtAvailable';
import { branchStore } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

// §121.1 — Holder object instead of a raw module-level \`let\` so the
// compaction counter isn't externally writable.
const compactionState = { incrementalSaveCount: 0 };
const COMPACTION_THRESHOLD = 50;

/**
 * Create a new CRDT-backed project.
 */
export async function createCrdtProject(name: string): Promise<void> {
    automergeRepository.createProject(name);
    await compactProject();
}

/**
 * Load a CRDT project from persistence (IndexedDB).
 * Returns true if a project was loaded, false if none was found.
 */
export async function loadCrdtProject(): Promise<boolean> {
    const bundle = await loadAllFromIdb();
    if (bundle) {
        await automergeRepository.loadAll(bundle);
        restoreActiveBranchSlot();
        return true;
    }
    return false;
}

/**
 * After a fresh load, point the active `DOC_PREFIX_ROOT` slot at the branch the
 * user was last on. `DOC_PREFIX_ROOT` mirrors the active branch's working doc;
 * without this the user lands on whatever doc last occupied the root slot rather
 * than their selected branch. The main branch is backed directly by the root
 * slot (`rootDocId === DOC_PREFIX_ROOT`), so its restore is a no-op.
 */
function restoreActiveBranchSlot(): void {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const active = state.branches.find((b) => b.branchId === state.activeBranchId);
    if (!active || active.rootDocId === DOC_PREFIX_ROOT) {
        return;
    }

    const branchDoc = automergeRepository.getDoc(active.rootDocId);
    if (!branchDoc) {
        // The active branch's doc was not in the loaded bundle (e.g. it was
        // deleted or never persisted). Leave the root slot as loaded.
        logger.warn(
            `[loadCrdtProject] Active branch document not found on load: ${active.rootDocId}; staying on root slot`
        );
        return;
    }

    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc);
}

/**
 * Persist the current project incrementally.
 *
 * Uses `Automerge.saveIncremental()` which only serializes changes since
 * the last save — much faster than a full save for small edits.
 * Periodically compacts to a full snapshot for fast startup and bounded storage.
 */
export async function persistCrdtProject(): Promise<void> {
    const chunk = automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT);
    if (chunk && chunk.length > 0) {
        await saveIncrementalToIdb(DOC_PREFIX_ROOT, chunk);
        compactionState.incrementalSaveCount++;
    }

    if (compactionState.incrementalSaveCount >= COMPACTION_THRESHOLD) {
        await compactProject();
    }
}

/**
 * Write a full snapshot and clear incremental chunks.
 * Called periodically and on explicit save.
 */
export async function compactProject(): Promise<void> {
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
    await clearIncrementalsFromIdb(DOC_PREFIX_ROOT);
    compactionState.incrementalSaveCount = 0;
}

/**
 * Check whether a CRDT project exists in persistence.
 */
export async function hasCrdtProject(): Promise<boolean> {
    return hasCrdtDocsInIdb();
}

/**
 * Detect which persistence backend to use.
 */
export function getPersistenceBackend(): 'native' | 'browser' {
    if (isNativeCrdtAvailable()) {
        return 'native';
    }
    return 'browser';
}
