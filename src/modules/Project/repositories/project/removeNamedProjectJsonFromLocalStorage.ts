/**
 * Drop a per-project localStorage mirror. Call this only once the snapshot has
 * been observed to commit to IndexedDB, or once a newer IndexedDB copy has been
 * confirmed to exist — a mirror that has not been successfully rewritten is
 * never deleted (ADR 0013, Migration).
 */
export function removeNamedProjectJsonFromLocalStorage(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // localStorage unavailable — the mirror stays, which is the safe outcome.
    }
}
