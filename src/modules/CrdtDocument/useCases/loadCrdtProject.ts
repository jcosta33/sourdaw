import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import { sanitizePersistedActionHistoryBundle } from '../repositories/sanitizePersistedActionHistoryBundle';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import { branchStore } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { runCrdtPersistenceLoad } from './runCrdtPersistenceLoad';

/**
 * Load a CRDT project from persistence (IndexedDB).
 * Returns true if a project was loaded, false if none was found.
 */
type LoadCrdtProjectInput = {
    shouldCommit?: () => boolean;
};

export function loadCrdtProject({ shouldCommit }: LoadCrdtProjectInput = {}): Promise<boolean> {
    return runCrdtPersistenceLoad(async ({ shouldCommit: shouldCommitQueue }) => {
        function canCommit(): boolean {
            return shouldCommitQueue() && shouldCommit?.() !== false;
        }
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }

        resetActionReplayAuthority();
        const snapshot = await loadPersistenceSnapshotFromIdb();
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }
        if (!snapshot?.bundle) {
            return { loaded: false, snapshot };
        }

        const sanitized_bundle = sanitizePersistedActionHistoryBundle({ bundle: snapshot.bundle });
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }

        const persisted = await saveAllToIdb(sanitized_bundle, { expectedAuthority: snapshot.authority });
        if (persisted.status === 'conflict') {
            throw new Error('[loadCrdtProject] Persisted project changed during action-history sanitation');
        }
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }

        const committed = await automergeRepository.loadAll({ bundle: sanitized_bundle, shouldCommit: canCommit });
        if (!committed || !canCommit()) {
            return { loaded: false, snapshot: null };
        }
        restoreActiveBranchSlot();
        return {
            loaded: true,
            snapshot: {
                ...snapshot,
                authority: persisted.authority,
                bundle: sanitized_bundle,
            },
        };
    });
}

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
        return;
    }

    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc);
}
