import { STORE_NAME, openDatabase } from './helpers';

/** Check whether IndexedDB contains any persisted records without reading their bytes. */
export async function hasCrdtDocsInIdb(): Promise<boolean> {
    const database = await openDatabase();
    if (!database) {
        return false;
    }

    return new Promise((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
            transaction = database.transaction(STORE_NAME, 'readonly');
        } catch (error) {
            reject(error instanceof Error ? error : new Error('IDB transaction could not be opened', { cause: error }));
            return;
        }

        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}
