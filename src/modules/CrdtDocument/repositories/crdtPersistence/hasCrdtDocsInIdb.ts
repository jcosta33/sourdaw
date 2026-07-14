import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/** Check whether the persisted bundle contains the loadable root document. */
export async function hasCrdtDocsInIdb(): Promise<boolean> {
    const database = await openDatabase();
    if (!database) {
        return false;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getKey(DOC_PREFIX_ROOT);
        request.onsuccess = () => resolve(request.result === DOC_PREFIX_ROOT);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}
