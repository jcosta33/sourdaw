import { automergeRepository } from '../repositories/automergeRepository';
import { loadAllFromIdb } from '../repositories/crdtPersistence/loadAllFromIdb';

/**
 * Load a CRDT project from persistence (IndexedDB).
 * Returns true if a project was loaded, false if none was found.
 */
type LoadCrdtProjectInput = {
    shouldCommit?: () => boolean;
};

export async function loadCrdtProject({ shouldCommit }: LoadCrdtProjectInput = {}): Promise<boolean> {
    const bundle = await loadAllFromIdb();
    if (bundle) {
        const committed = await automergeRepository.loadAll({ bundle, shouldCommit });
        if (!committed) {
            return false;
        }
        if (shouldCommit?.() === false) {
            return false;
        }
        return true;
    }
    return false;
}
