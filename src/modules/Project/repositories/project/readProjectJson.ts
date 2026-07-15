import { storageSupport } from './storageSupport';

export function readProjectJson(): string | null {
    // Sync read from cache (populated from IndexedDB on init, or from writes)
    const cached = storageSupport.getCachedJson();
    if (cached) {
        return cached;
    }

    // Fallback: try localStorage for migration from old storage
    try {
        const legacy = window.localStorage.getItem(storageSupport.legacyProjectStorageKey);
        if (legacy) {
            storageSupport.setCachedJson(legacy);
            // Migrate to IndexedDB
            storageSupport.putIndexedDb(storageSupport.primaryKey, legacy);
            return legacy;
        }
    } catch {
        // localStorage not available
    }

    return null;
}
