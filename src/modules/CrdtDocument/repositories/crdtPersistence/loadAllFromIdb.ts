import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/** Load all documents from IndexedDB. */
export async function loadAllFromIdb(): Promise<DocumentBundle | null> {
    const database = await openDatabase();
    if (!database) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();

        tx.oncomplete = () => {
            const keys = keysRequest.result;
            const values = valuesRequest.result as Uint8Array[];

            if (keys.length === 0) {
                resolve(null);
                return;
            }

            const bundle: DocumentBundle = new Map();
            for (let index = 0; index < keys.length; index++) {
                const value = values[index];
                if (value) {
                    bundle.set(keys[index] as string, value);
                }
            }
            resolve(bundle);
        };

        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
    });
}
