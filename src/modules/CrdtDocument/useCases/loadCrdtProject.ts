import { logger } from '#/infra/logger/appLogger';

import { automergeRepository } from '../repositories/automergeRepository';
import { loadAllFromIdb } from '../repositories/crdtPersistence/loadAllFromIdb';
import { branchStore } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

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

    const active = state.branches.find((branch) => branch.branchId === state.activeBranchId);
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
