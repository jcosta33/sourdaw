import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';

import { runCrdtPersistenceLoad } from './crdtPersistenceQueue';

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

        const snapshot = await loadPersistenceSnapshotFromIdb();
        if (!canCommit()) {
            return { loaded: false, snapshot: null };
        }
        if (!snapshot?.bundle) {
            return { loaded: false, snapshot };
        }

        const committed = await automergeRepository.loadAll({ bundle: snapshot.bundle, shouldCommit: canCommit });
        if (!committed || !canCommit()) {
            return { loaded: false, snapshot: null };
        }
        return { loaded: true, snapshot };
    });
}
