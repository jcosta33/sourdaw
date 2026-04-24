import { STORE_NAME, openDatabase } from './helpers';

/** Check whether any CRDT documents exist in IndexedDB. */
export async function hasCrdtDocsInIdb(): Promise<boolean> {
    const database = await openDatabase();
    if (!database) {
        return false;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}
