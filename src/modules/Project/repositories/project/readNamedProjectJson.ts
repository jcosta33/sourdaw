import { readNamedProjectJsonFromLocalStorage } from './readNamedProjectJsonFromLocalStorage';
import { storageSupport } from './storageSupport';

/**
 * Read a named project, falling back to IndexedDB.
 *
 * `writeNamedProjectJson` dual-writes to IndexedDB and localStorage, but the
 * localStorage write fails silently when the project exceeds the ~5–10 MB
 * localStorage quota — leaving such projects reachable only from IndexedDB.
 * This read returns the localStorage copy when present and otherwise falls back
 * to IndexedDB, so large/quota-exceeded named projects remain loadable.
 */
export async function readNamedProjectJson(key: string): Promise<string | null> {
    const local = readNamedProjectJsonFromLocalStorage(key);
    if (local !== null) {
        return local;
    }

    await storageSupport.initializeIndexedDb();
    return storageSupport.getIndexedDb(key);
}
