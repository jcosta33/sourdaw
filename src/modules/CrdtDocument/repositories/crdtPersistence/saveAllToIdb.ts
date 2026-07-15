import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { advancePersistenceAuthority } from './advancePersistenceAuthority';
import { arePersistenceAuthoritiesEqual } from './arePersistenceAuthoritiesEqual';
import { bindTransactionAbortSignal } from './bindTransactionAbortSignal';
import { decodePersistenceAuthority } from './decodePersistenceAuthority';
import { decodePersistenceBundle } from './decodePersistenceBundle';
import { encodePersistenceAuthority } from './encodePersistenceAuthority';
import { STORE_NAME, openDatabase } from './helpers';
import {
    EMPTY_PERSISTENCE_AUTHORITY,
    PERSISTENCE_AUTHORITY_KEY,
    type CrdtPersistenceAuthority,
} from './persistenceAuthorityModel';

export type SaveAllToIdbOptions = {
    expectedAuthority?: CrdtPersistenceAuthority;
    nextEpoch?: string;
    nextRootLineage?: string;
    signal?: AbortSignal;
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
            authority: advancePersistenceAuthority(
                current,
                options.nextEpoch ?? current.epoch,
                options.nextRootLineage ?? current.rootLineage
            ),
        };
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const authorityRequest = store.get(PERSISTENCE_AUTHORITY_KEY);
        let transactionResult: SaveAllToIdbResult | null = null;
        let conflictKeysRequest: IDBRequest<IDBValidKey[]> | null = null;
        let conflictValuesRequest: IDBRequest<unknown[]> | null = null;
        let detachAbortSignal: (() => void) | null = null;

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

            const nextAuthority = advancePersistenceAuthority(
                current,
                options.nextEpoch ?? current.epoch,
                options.nextRootLineage ?? current.rootLineage
            );
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
            detachAbortSignal?.();
            try {
                if (transactionResult?.status === 'conflict' && conflictKeysRequest && conflictValuesRequest) {
                    transactionResult = {
                        ...transactionResult,
                        bundle: decodePersistenceBundle(conflictKeysRequest.result, conflictValuesRequest.result),
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
        tx.onerror = () => {
            detachAbortSignal?.();
            reject(tx.error ?? new Error('IDB transaction failed'));
        };
        tx.onabort = () => {
            detachAbortSignal?.();
            reject(tx.error ?? new Error('IDB transaction aborted'));
        };
        authorityRequest.onerror = () => {
            detachAbortSignal?.();
            reject(authorityRequest.error ?? new Error('IDB authority read failed'));
        };
        detachAbortSignal = bindTransactionAbortSignal(tx, options.signal);
    });
}
