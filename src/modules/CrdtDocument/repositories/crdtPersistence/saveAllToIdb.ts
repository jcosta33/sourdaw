import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';
import {
    advancePersistenceAuthority,
    arePersistenceAuthoritiesEqual,
    decodePersistenceAuthority,
    EMPTY_PERSISTENCE_AUTHORITY,
    encodePersistenceAuthority,
    PERSISTENCE_AUTHORITY_KEY,
    toPersistenceBytes,
    type CrdtPersistenceAuthority,
} from './persistenceAuthority';

export type SaveAllToIdbOptions = {
    expectedAuthority?: CrdtPersistenceAuthority;
    nextEpoch?: string;
};

export type SaveAllToIdbResult =
    | {
          status: 'committed';
          authority: CrdtPersistenceAuthority;
      }
    | {
          status: 'conflict';
          authority: CrdtPersistenceAuthority;
          bundle: DocumentBundle;
      };

function readBundle(keys: IDBValidKey[], values: unknown[]): DocumentBundle {
    const bundle: DocumentBundle = new Map();
    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const value = values[index];
        if (typeof key !== 'string') {
            throw new TypeError(`[CrdtPersistence] Invalid persisted key at index ${index}`);
        }
        if (key === PERSISTENCE_AUTHORITY_KEY) {
            continue;
        }
        const bytes = toPersistenceBytes(value);
        if (!bytes) {
            throw new TypeError(`[CrdtPersistence] Invalid persisted record at index ${index}`);
        }
        bundle.set(key, bytes);
    }
    return bundle;
}

/**
 * Replace all persisted documents with a compare-and-swap guarded snapshot.
 * The authority read, stale check, clear, puts, and revision advance share one
 * IDB transaction, so a stale realm can only receive a conflict snapshot.
 */
export async function saveAllToIdb(
    bundle: DocumentBundle,
    options: SaveAllToIdbOptions = {}
): Promise<SaveAllToIdbResult> {
    const database = await openDatabase();
    if (!database) {
        const current = options.expectedAuthority ?? EMPTY_PERSISTENCE_AUTHORITY;
        return {
            status: 'committed',
            authority: advancePersistenceAuthority(current, options.nextEpoch ?? current.epoch),
        };
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const authorityRequest = store.get(PERSISTENCE_AUTHORITY_KEY);
        let transactionResult: SaveAllToIdbResult | null = null;
        let conflictKeysRequest: IDBRequest<IDBValidKey[]> | null = null;
        let conflictValuesRequest: IDBRequest<unknown[]> | null = null;

        authorityRequest.onsuccess = () => {
            const current = decodePersistenceAuthority(authorityRequest.result);
            const expected = options.expectedAuthority;

            if (expected && !arePersistenceAuthoritiesEqual(expected, current)) {
                conflictKeysRequest = store.getAllKeys();
                conflictValuesRequest = store.getAll();
                transactionResult = {
                    status: 'conflict',
                    authority: current,
                    bundle: new Map(),
                };
                return;
            }

            const nextAuthority = advancePersistenceAuthority(current, options.nextEpoch ?? current.epoch);
            store.clear();
            for (const [id, bytes] of bundle) {
                store.put(new Uint8Array(bytes), id);
            }
            store.put(encodePersistenceAuthority(nextAuthority), PERSISTENCE_AUTHORITY_KEY);
            transactionResult = {
                status: 'committed',
                authority: nextAuthority,
            };
        };

        tx.oncomplete = () => {
            try {
                if (transactionResult?.status === 'conflict' && conflictKeysRequest && conflictValuesRequest) {
                    transactionResult = {
                        ...transactionResult,
                        bundle: readBundle(conflictKeysRequest.result, conflictValuesRequest.result),
                    };
                }
                if (!transactionResult) {
                    reject(new Error('IDB transaction completed without a persistence result'));
                    return;
                }
                resolve(transactionResult);
            } catch (error: unknown) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        };
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
        authorityRequest.onerror = () => reject(authorityRequest.error ?? new Error('IDB authority read failed'));
    });
}
