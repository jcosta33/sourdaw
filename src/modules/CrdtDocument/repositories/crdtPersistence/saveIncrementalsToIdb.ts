import { type DocumentBundle, type DocId } from '../../models/CrdtDocumentTypes';

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

export type IncrementalChunk = {
    id: DocId;
    chunk: Uint8Array;
};

export type SaveIncrementalsToIdbOptions = {
    expectedAuthority?: CrdtPersistenceAuthority;
    signal?: AbortSignal;
};

export type SaveIncrementalsToIdbResult =
    | {
          status: 'committed';
          authority: CrdtPersistenceAuthority;
      }
    | {
          status: 'conflict';
          authority: CrdtPersistenceAuthority;
          bundle: DocumentBundle;
      };

/** Append incremental chunks under the same durable authority transaction. */
export async function saveIncrementalsToIdb(
    chunks: readonly IncrementalChunk[],
    options: SaveIncrementalsToIdbOptions = {}
): Promise<SaveIncrementalsToIdbResult> {
    const nonEmptyChunks = chunks.filter(({ chunk }) => chunk.length > 0);
    if (nonEmptyChunks.length === 0) {
        return {
            status: 'committed',
            authority: options.expectedAuthority ?? EMPTY_PERSISTENCE_AUTHORITY,
        };
    }

    const database = await openDatabase();
    if (!database) {
        const current = options.expectedAuthority ?? EMPTY_PERSISTENCE_AUTHORITY;
        return {
            status: 'committed',
            authority: advancePersistenceAuthority(current),
        };
    }

    const orderedChunks = [...nonEmptyChunks].sort((alpha, bravo) => {
        if (alpha.id < bravo.id) {
            return -1;
        }
        if (alpha.id > bravo.id) {
            return 1;
        }
        return 0;
    });

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const authorityRequest = store.get(PERSISTENCE_AUTHORITY_KEY);
        let transactionResult: SaveIncrementalsToIdbResult | null = null;
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

            const timestamp = Date.now();
            for (const [index, item] of orderedChunks.entries()) {
                const key = `${item.id}:incremental:${timestamp}-${(current.revision + index).toString(36)}`;
                // `add` preserves each chunk as an append-only record. The
                // authority revision supplies a cross-realm ordering token.
                store.add(new Uint8Array(item.chunk), key);
            }

            const nextAuthority = advancePersistenceAuthority(current);
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
