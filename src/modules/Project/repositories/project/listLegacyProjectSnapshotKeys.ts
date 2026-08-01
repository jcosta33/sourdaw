import { NAMED_PROJECT_KEY_PREFIX } from '../../models/ProjectData';

/**
 * Enumerate the per-project snapshot keys still mirrored in localStorage by
 * builds that predate ADR 0013. Returns an empty list once the migration has
 * drained them, and never reports keys this module does not own (the
 * recent-projects index, the legacy single-project key, anything else).
 */
export function listLegacyProjectSnapshotKeys(): string[] {
    const keys: string[] = [];
    try {
        for (let index = 0; index < window.localStorage.length; index++) {
            const key = window.localStorage.key(index);
            if (key !== null && key.startsWith(NAMED_PROJECT_KEY_PREFIX)) {
                keys.push(key);
            }
        }
    } catch {
        return [];
    }
    return keys;
}
