import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import {
    hasCrdtDocsInIdb,
    loadAllFromIdb,
    saveAllToIdb,
    saveIncrementalToIdb,
    clearIncrementalsFromIdb,
} from '../repositories/crdtPersistence';
import { isNativeCrdtAvailable } from '../repositories/nativeCrdtPersistence';

let incrementalSaveCount = 0;
const COMPACTION_THRESHOLD = 50;

/**
 * Create a new CRDT-backed project.
 */
export const createCrdtProject = async (name: string): Promise<void> => {
    automergeRepository.createProject(name);
    await compactProject();
};

/**
 * Load a CRDT project from persistence (IndexedDB).
 * Returns true if a project was loaded, false if none was found.
 */
export const loadCrdtProject = async (): Promise<boolean> => {
    const bundle = await loadAllFromIdb();
    if (bundle) {
        await automergeRepository.loadAll(bundle);
        return true;
    }
    return false;
};

/**
 * Persist the current project incrementally.
 *
 * Uses `Automerge.saveIncremental()` which only serializes changes since
 * the last save — much faster than a full save for small edits.
 * Periodically compacts to a full snapshot for fast startup and bounded storage.
 */
export const persistCrdtProject = async (): Promise<void> => {
    const chunk = automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT);
    if (chunk && chunk.length > 0) {
        await saveIncrementalToIdb(DOC_PREFIX_ROOT, chunk);
        incrementalSaveCount++;
    }

    if (incrementalSaveCount >= COMPACTION_THRESHOLD) {
        await compactProject();
    }
};

/**
 * Write a full snapshot and clear incremental chunks.
 * Called periodically and on explicit save.
 */
export const compactProject = async (): Promise<void> => {
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);
    await clearIncrementalsFromIdb(DOC_PREFIX_ROOT);
    incrementalSaveCount = 0;
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
