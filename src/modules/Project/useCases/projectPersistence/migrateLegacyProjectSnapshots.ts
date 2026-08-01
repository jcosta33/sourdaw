import { logger } from '#/infra/logger/appLogger';

import { listLegacyProjectSnapshotKeys } from '../../repositories/project/listLegacyProjectSnapshotKeys';
import { pickNewerProjectSnapshot } from '../../repositories/project/pickNewerProjectSnapshot';
import { readNamedProjectJsonFromIndexedDb } from '../../repositories/project/readNamedProjectJsonFromIndexedDb';
import { readNamedProjectJsonFromLocalStorage } from '../../repositories/project/readNamedProjectJsonFromLocalStorage';
import { removeNamedProjectJsonFromLocalStorage } from '../../repositories/project/removeNamedProjectJsonFromLocalStorage';
import { writeNamedProjectJsonByKey } from '../../repositories/project/writeNamedProjectJsonByKey';

type MigrateLegacyProjectSnapshotsOutput = {
    /** localStorage snapshot keys found. */
    inspected: number;
    /** Mirrors rewritten into IndexedDB and then unmirrored. */
    recovered: number;
    /** Mirrors dropped because IndexedDB already held an equal-or-newer copy. */
    supersededByPrimary: number;
    /**
     * Mirrors with no IndexedDB counterpart at all. ADR 0013's stop condition:
     * a large count here means the `if (!db) return` early-return path was
     * common in practice, recent-projects was running off localStorage, and
     * this stops being a cleanup.
     */
    mirrorsWithoutPrimary: number;
    /** Mirrors whose rewrite failed. Their localStorage keys survive untouched. */
    failed: number;
};

/**
 * Drain pre-ADR-0013 per-project localStorage snapshots into IndexedDB.
 *
 * Order is the whole point: read the mirror, write it through the observed
 * IndexedDB path, and only then remove the key. A mirror whose rewrite did not
 * commit is left exactly where it is, so a failed migration costs nothing and
 * retries on the next load.
 *
 * A mirror is never allowed to overwrite a newer IndexedDB copy — that is the
 * same stale-snapshot data loss this migration exists to end. When the primary
 * is equal or newer the mirror carries nothing to recover and is simply
 * dropped.
 */
export async function migrateLegacyProjectSnapshots(): Promise<MigrateLegacyProjectSnapshotsOutput> {
    const keys = listLegacyProjectSnapshotKeys();
    const report: MigrateLegacyProjectSnapshotsOutput = {
        inspected: keys.length,
        recovered: 0,
        supersededByPrimary: 0,
        mirrorsWithoutPrimary: 0,
        failed: 0,
    };

    for (const key of keys) {
        const mirror = readNamedProjectJsonFromLocalStorage(key);
        if (mirror === null) {
            continue;
        }

        // Sequential by design: these transactions contend on one object store
        // and the count of failures is only meaningful if each one is observed.
        const primary = await readNamedProjectJsonFromIndexedDb(key);

        if (primary === null) {
            report.mirrorsWithoutPrimary++;
        }

        if (primary !== null && pickNewerProjectSnapshot({ primary, mirror }) === 'primary') {
            removeNamedProjectJsonFromLocalStorage(key);
            report.supersededByPrimary++;
            continue;
        }

        try {
            await writeNamedProjectJsonByKey(key, mirror);
        } catch (error) {
            report.failed++;
            logger.warn(`[migrateLegacyProjectSnapshots] Rewrite failed for ${key}; keeping the mirror:`, error);
            continue;
        }

        removeNamedProjectJsonFromLocalStorage(key);
        report.recovered++;
    }

    return report;
}
