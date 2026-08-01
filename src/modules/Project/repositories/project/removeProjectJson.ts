import { logger } from '#/infra/logger/appLogger';

import { storageSupport } from './storageSupport';

/**
 * Clear the active project document from the cache, from IndexedDB, and from
 * the legacy localStorage key that pre-ADR-0013 builds mirrored it to.
 *
 * The cache clear is what callers depend on synchronously. The IndexedDB delete
 * is now an observed transaction; nothing reports this call as a durable
 * outcome, so a failed delete is logged rather than thrown — but it is not
 * swallowed the way the old fire-and-forget delete was.
 */
export function removeProjectJson(): void {
    storageSupport.setCachedJson(null);
    try {
        window.localStorage.removeItem(storageSupport.legacyProjectStorageKey);
    } catch {
        // localStorage unavailable — nothing mirrored there to clear.
    }
    storageSupport.deleteIndexedDb(storageSupport.primaryKey).catch((error: unknown) => {
        logger.warn('[removeProjectJson] Failed to delete the active project from IndexedDB:', error);
    });
}
