import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

export async function replaceAllInIdb(bundle: DocumentBundle): Promise<void> {
    const database = await openDatabase();
    if (!database) {
        throw new Error('CRDT persistence is unavailable');
    }

    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        for (const [id, bytes] of bundle) {
            store.put(bytes, id);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}
