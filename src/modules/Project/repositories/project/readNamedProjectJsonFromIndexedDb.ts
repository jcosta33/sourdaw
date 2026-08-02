import { storageSupport } from './storageSupport';

/**
 * Read a named project from IndexedDB — the store this build writes project
 * content to. Awaits the database open rather than null-checking the handle, so
 * a read issued during the page-load window sees the stored copy instead of
 * reporting it absent. Resolves `null` when the key is absent or the database
 * cannot be opened.
 */
export async function readNamedProjectJsonFromIndexedDb(key: string): Promise<string | null> {
    await storageSupport.initializeIndexedDb();
    return storageSupport.getIndexedDb(key);
}
