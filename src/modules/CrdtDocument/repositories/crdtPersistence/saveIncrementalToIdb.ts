import { type DocId } from '../../models/CrdtDocumentTypes';
import { STORE_NAME, openDatabase } from './helpers';

/** Save an incremental chunk for a document (append, don't replace). */
export const saveIncrementalToIdb = async (id: DocId, chunk: Uint8Array): Promise<void> => {
    if (chunk.length === 0) {
        return;
    }
    const database = await openDatabase();
    if (!database) {
        return;
    }

    const key = `${id}:incremental:${Date.now()}`;
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(chunk, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};