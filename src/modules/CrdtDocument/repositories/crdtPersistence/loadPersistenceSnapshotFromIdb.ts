import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';
import {
    decodePersistenceAuthority,
    EMPTY_PERSISTENCE_AUTHORITY,
    PERSISTENCE_AUTHORITY_KEY,
    toPersistenceBytes,
    type CrdtPersistenceAuthority,
} from './persistenceAuthority';

export type CrdtPersistenceSnapshot = {
    readonly authority: CrdtPersistenceAuthority;
    readonly bundle: DocumentBundle | null;
};

/** Read the durable authority and document bundle from one IndexedDB snapshot. */
export async function loadPersistenceSnapshotFromIdb(): Promise<CrdtPersistenceSnapshot | null> {
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
            try {
                const keys = keysRequest.result;
                const values = valuesRequest.result as unknown[];
                let authority = EMPTY_PERSISTENCE_AUTHORITY;
                const bundle: DocumentBundle = new Map();

                for (let index = 0; index < keys.length; index++) {
                    const key = keys[index];
                    const value = values[index];
                    if (typeof key !== 'string') {
                        throw new TypeError(`[CrdtPersistence] Invalid persisted key at index ${index}`);
                    }
                    if (key === PERSISTENCE_AUTHORITY_KEY) {
                        authority = decodePersistenceAuthority(value);
                        continue;
                    }
                    const bytes = toPersistenceBytes(value);
                    if (!bytes) {
                        throw new TypeError(`[CrdtPersistence] Invalid persisted record at index ${index}`);
                    }
                    bundle.set(key, bytes);
                }

                resolve({
                    authority,
                    bundle: bundle.size === 0 ? null : bundle,
                });
            } catch (error: unknown) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        };

        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    });
}
