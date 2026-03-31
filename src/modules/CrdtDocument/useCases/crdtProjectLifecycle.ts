import { automergeRepository } from '../repositories/automergeRepository';
import { hasCrdtDocsInIdb, loadAllFromIdb, saveAllToIdb } from '../repositories/crdtPersistence';
import { isNativeCrdtAvailable } from '../repositories/nativeCrdtPersistence';

/**
 * Create a new CRDT-backed project.
 * Initializes the Automerge document store and persists to IndexedDB.
 */
export const createCrdtProject = async (name: string): Promise<void> => {
    automergeRepository.createProject(name);
    await persistCrdtProject();
};

/**
 * Load a CRDT project from persistence (IndexedDB or native filesystem).
 * Returns true if a project was loaded, false if none was found.
 */
export const loadCrdtProject = async (): Promise<boolean> => {
    // Try IndexedDB first (works in both browser and Tauri)
    const bundle = await loadAllFromIdb();
    if (bundle) {
        automergeRepository.loadAll(bundle);
        return true;
    }

    return false;
};

/**
 * Save the current CRDT project to persistence.
 */
export const persistCrdtProject = async (): Promise<void> => {
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
};

/**
 * Check whether a CRDT project exists in persistence.
 */
export const hasCrdtProject = async (): Promise<boolean> => {
    return hasCrdtDocsInIdb();
};

/**
 * Detect which persistence backend to use.
 */
export const getPersistenceBackend = (): 'native' | 'browser' => {
    if (isNativeCrdtAvailable()) {
        return 'native';
    }
    return 'browser';
};
