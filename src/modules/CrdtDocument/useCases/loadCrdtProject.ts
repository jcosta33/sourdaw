import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import { saveAllToIdb } from '../repositories/crdtPersistence/saveAllToIdb';
import { sanitizePersistedActionHistoryBundle } from '../repositories/sanitizePersistedActionHistoryBundle';
import { branchStore } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { runCrdtPersistenceLoad } from './runCrdtPersistenceLoad';

const MAX_SANITIZATION_ATTEMPTS = 3;

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

        let active_bundle = snapshot.bundle;
        let active_authority = snapshot.authority;
        for (let attempt = 0; attempt < MAX_SANITIZATION_ATTEMPTS; attempt++) {
            const sanitized = sanitizePersistedActionHistoryBundle({ bundle: active_bundle });
            active_bundle = sanitized.bundle;
            if (!sanitized.changed) {
                break;
            }
            if (!canCommit()) {
                return { loaded: false, snapshot: null };
            }

            const persisted = await saveAllToIdb(active_bundle, { expectedAuthority: active_authority });
            if (persisted.status === 'committed') {
                active_authority = persisted.authority;
                break;
            }
            if (attempt === MAX_SANITIZATION_ATTEMPTS - 1) {
                throw new Error('[loadCrdtProject] Persisted project kept changing during action-history sanitation');
            }
            active_bundle = persisted.bundle;
            active_authority = persisted.authority;
        }
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }

        const committed = await automergeRepository.loadAll({ bundle: active_bundle, shouldCommit: canCommit });
        if (!committed || !canCommit()) {
            return { loaded: false, snapshot: null };
        }
        restoreActiveBranchSlot();
        return {
            loaded: true,
            snapshot: {
                ...snapshot,
                authority: active_authority,
                bundle: active_bundle,
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
