import { storageSupport } from './storageSupport';

/**
 * Dual-write a named project blob under a full storage key (IndexedDB primary,
 * localStorage fallback). The caller passes the complete key — e.g.
 * `sourdaw:project:<createdAt>` — so the write key matches the recent-projects
 * entry key and {@link readNamedProjectJson}'s read key exactly. This is the
 * single dual-write implementation; {@link writeNamedProjectJson} builds a key
 * from a name and delegates here.
 */
export function writeNamedProjectJsonByKey(key: string, json: string): void {
    storageSupport.putIndexedDb(key, json);
    try {
        window.localStorage.setItem(key, json);
    } catch {
        // Quota exceeded — IndexedDB has it
    }
}
