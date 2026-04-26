import { type DocId } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/** Save a single document to IndexedDB. */
export async function saveDocToIdb(id: DocId, bytes: Uint8Array): Promise<void> {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(bytes, id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}
