import { logger } from '#/infra/logger/appLogger';

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
            // Migrate to IndexedDB. This synchronous read cannot await the
            // transaction, but the failure is reported rather than dropped —
            // and the legacy key stays put either way, so a failed migration
            // retries on the next read.
            storageSupport.putIndexedDb(storageSupport.primaryKey, legacy).catch((error: unknown) => {
                logger.warn('[readProjectJson] Legacy project migration to IndexedDB failed:', error);
            });
            return legacy;
        }
    } catch {
        // localStorage not available
    }

    return null;
}
