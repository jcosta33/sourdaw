import { STORE_NAME, openDatabase } from './helpers';

/** Clear all stored CRDT documents. */
export const clearCrdtIdb = async (): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};
