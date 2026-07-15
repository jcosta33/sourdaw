import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';

import { setCrdtPersistenceAuthority } from './crdtPersistenceQueue';

/**
 * Load a CRDT project from persistence (IndexedDB).
 * Returns true if a project was loaded, false if none was found.
 */
type LoadCrdtProjectInput = {
    shouldCommit?: () => boolean;
};

export async function loadCrdtProject({ shouldCommit }: LoadCrdtProjectInput = {}): Promise<boolean> {
    const snapshot = await loadPersistenceSnapshotFromIdb();
    if (snapshot?.bundle) {
        const committed = await automergeRepository.loadAll({ bundle: snapshot.bundle, shouldCommit });
        if (!committed) {
            return false;
        }
        if (shouldCommit?.() === false) {
            return false;
        }
        setCrdtPersistenceAuthority(snapshot.authority);
        return true;
    }

    if (!snapshot || shouldCommit?.() === false) {
        return false;
    }

    setCrdtPersistenceAuthority(snapshot.authority);
    return false;
}
