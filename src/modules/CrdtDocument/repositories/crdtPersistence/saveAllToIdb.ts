import { type DocumentBundle } from '../../models/CrdtDocumentTypes';
import { STORE_NAME, openDatabase } from './helpers';

/** Save all documents to IndexedDB. */
export const saveAllToIdb = async (bundle: DocumentBundle): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Clear existing docs first
        store.clear();

        // Write all documents
        for (const [id, bytes] of bundle) {
            store.put(bytes, id);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};