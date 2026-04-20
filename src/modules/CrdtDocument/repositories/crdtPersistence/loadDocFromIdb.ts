import { type DocId } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/** Load a single document from IndexedDB. */
export const loadDocFromIdb = async (id: DocId): Promise<Uint8Array | null> => {
    const database = await openDatabase();
    if (!database) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            const result = request.result as Uint8Array | undefined;
            resolve(result ?? null);
        };
        request.onerror = () => reject(request.error);
    });
};
