import { type DocId } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/** Load all incremental chunks for a document and apply them to the base. */
export async function loadIncrementalsFromIdb(id: DocId): Promise<Uint8Array[]> {
    const database = await openDatabase();
    if (!database) {
        return [];
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const prefix = `${id}:incremental:`;
        const chunks: Uint8Array[] = [];

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
                if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                    chunks.push(cursor.value as Uint8Array);
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve(chunks);
        tx.onerror = () => reject(tx.error);
    });
}
