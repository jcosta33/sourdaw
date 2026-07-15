import { storageSupport } from './storageSupport';

export function writeProjectJson(json: string): void {
    // Update cache synchronously
    storageSupport.setCachedJson(json);

    // Write to IndexedDB (async, no size limit)
    storageSupport.putIndexedDb(storageSupport.primaryKey, json);

    // Also try localStorage as a fallback (may fail for large projects)
    try {
        window.localStorage.setItem(storageSupport.legacyProjectStorageKey, json);
    } catch {
        // Quota exceeded — IndexedDB has it, so this is fine
    }
}
