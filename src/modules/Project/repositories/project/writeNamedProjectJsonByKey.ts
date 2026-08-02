import { storageSupport } from './storageSupport';

/**
 * Write a named project blob under a full storage key. The caller passes the
 * complete key — e.g. `sourdaw:project:<createdAt>` — so the write key matches
 * the recent-projects entry key and {@link readNamedProjectJson}'s read key
 * exactly.
 *
 * IndexedDB is the only store project content is written to (ADR 0013):
 * localStorage holds the recent-projects index and pointers, never a document.
 * Resolves only once the transaction has committed, and rejects when it aborts
 * or when the database cannot be opened — callers must not report a save as
 * successful without observing this promise settle.
 */
export async function writeNamedProjectJsonByKey(key: string, json: string): Promise<void> {
    await storageSupport.putIndexedDb(key, json);
}
