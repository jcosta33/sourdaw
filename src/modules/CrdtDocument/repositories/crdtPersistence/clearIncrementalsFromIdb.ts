import { type DocId } from '../../models/CrdtDocumentTypes';
import { STORE_NAME, openDatabase } from './helpers';

/** Remove all incremental chunks for a document (after compaction). */
export const clearIncrementalsFromIdb = async (id: DocId): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const prefix = `${id}:incremental:`;

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
                if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};