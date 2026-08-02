import { storageSupport } from './storageSupport';

/**
 * Persist the active project document.
 *
 * The synchronous cache is updated first so an immediate {@link readProjectJson}
 * sees the new value regardless of how the write settles. The durable write
 * goes to IndexedDB only — the localStorage copy this used to keep was project
 * content in a 5 MiB bounded store whose quota throw was swallowed (ADR 0013).
 *
 * Rejects when the transaction aborts or the database cannot be opened. Callers
 * must await it rather than treat the call as fire-and-forget.
 */
export async function writeProjectJson(json: string): Promise<void> {
    storageSupport.setCachedJson(json);
    await storageSupport.putIndexedDb(storageSupport.primaryKey, json);
}
