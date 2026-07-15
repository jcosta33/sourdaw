/**
 * Synchronous localStorage-only read for a named project. Returns `null` when
 * the key is absent or localStorage is unavailable. This sees only projects
 * whose `writeNamedProjectJson` localStorage write succeeded — large projects
 * that overflowed the localStorage quota live only in IndexedDB and are not
 * visible here. Prefer {@link readNamedProjectJson} unless a synchronous read
 * is genuinely required.
 */
export function readNamedProjectJsonFromLocalStorage(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}
