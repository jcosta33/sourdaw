import { type DocId } from '../../models/CrdtDocumentTypes';

import { STORE_NAME, openDatabase } from './helpers';

/**
 * Strictly increasing, module-private sequence number for incremental chunk
 * keys. Two chunks saved within the same millisecond previously collided on
 * `Date.now()` + a 4-char random suffix; on collision the second `put`
 * overwrote the first, dropping a chunk and breaking convergence on reload.
 * A monotonic counter guarantees a unique, ordered suffix per save.
 */
let _incrementalSeq = 0;

/** Save an incremental chunk for a document (append, don't replace). */
export async function saveIncrementalToIdb(id: DocId, chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) {
        return;
    }
    const database = await openDatabase();
    if (!database) {
        return;
    }

    const seq = _incrementalSeq++;
    const key = `${id}:incremental:${Date.now()}-${seq.toString(36)}`;
    await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        // `add` throws on a duplicate key rather than silently overwriting an
        // existing chunk; combined with the monotonic counter this preserves
        // every chunk needed for convergence on the next load.
        store.add(chunk, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
    });
}
