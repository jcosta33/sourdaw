/**
 * Request persistent storage to prevent eviction under memory pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
    try {
        return await navigator.storage.persist();
    } catch {
        return false;
    }
}
