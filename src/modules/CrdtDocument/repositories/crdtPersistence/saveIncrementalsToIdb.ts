import { type DocId } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

export type IncrementalChunk = {
    id: DocId;
    chunk: Uint8Array;
};

/** Save a deterministic set of non-empty incremental chunks in one transaction. */
export async function saveIncrementalsToIdb(chunks: readonly IncrementalChunk[]): Promise<void> {
    const nonEmptyChunks = chunks.filter(({ chunk }) => chunk.length > 0);
    if (nonEmptyChunks.length === 0) {
        return;
    }

    const database = await openDatabase();
    if (!database) {
        return;
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

    await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        for (const { id, chunk } of orderedChunks) {
            const key = `${id}:incremental:${Date.now()}-${nextIncrementalSequence().toString(36)}`;
            // `add` preserves each chunk as an append-only record and rejects
            // accidental key reuse instead of silently overwriting history.
            store.add(new Uint8Array(chunk), key);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    });
}

let incrementalSequence = 0;

function nextIncrementalSequence(): number {
    return incrementalSequence++;
}
