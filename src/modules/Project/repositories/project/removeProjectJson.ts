import { storageSupport } from './storageSupport';

export function removeProjectJson(): void {
    storageSupport.setCachedJson(null);
    storageSupport.deleteIndexedDb(storageSupport.primaryKey);
    try {
        window.localStorage.removeItem(storageSupport.legacyProjectStorageKey);
    } catch {
        // Ignore
    }
}
