import { logger } from '#/infra/logger/appLogger';

import { ACTIVE_PROJECT_KEY, LEGACY_PROJECT_STORAGE_KEY } from '../../models/ProjectData';
import { compareProjectSnapshots } from '../../repositories/project/compareProjectSnapshots';
import { listLegacyProjectSnapshotKeys } from '../../repositories/project/listLegacyProjectSnapshotKeys';
import { readNamedProjectJsonFromIndexedDb } from '../../repositories/project/readNamedProjectJsonFromIndexedDb';
import { readNamedProjectJsonFromLocalStorage } from '../../repositories/project/readNamedProjectJsonFromLocalStorage';
import { removeNamedProjectJsonFromLocalStorage } from '../../repositories/project/removeNamedProjectJsonFromLocalStorage';
import { writeNamedProjectJsonByKey } from '../../repositories/project/writeNamedProjectJsonByKey';

/**
 * What happened to one mirror.
 *
 * - `recovered` — rewritten into IndexedDB, commit observed, key removed.
 * - `superseded` — IndexedDB held a copy **confirmed** equal or newer, so the
 *   mirror carried nothing and its key was removed without a rewrite.
 * - `unresolved` — the mirror could not be interpreted, so it was neither
 *   rewritten (that would push junk over a copy we cannot rule out as good) nor
 *   removed (it might be the only copy). Left exactly as found.
 * - `failed` — the rewrite did not commit. Key survives; retries next load.
 * - `absent` — nothing was there.
 */
type MirrorOutcome = 'absent' | 'recovered' | 'superseded' | 'unresolved' | 'failed';

type MigrateLegacyProjectSnapshotsOutput = {
    /** localStorage snapshot keys found under the per-project prefix. */
    inspected: number;
    recovered: number;
    supersededByPrimary: number;
    unresolved: number;
    /**
     * Mirrors with no IndexedDB counterpart at all. ADR 0013's stop condition:
     * a large count here would have meant the `if (!db) return` early-return
     * path was common in practice and recent-projects had been running off
     * localStorage. ADR 0016 settles that there are no users, so this is
     * instrumentation, not an open gate.
     */
    mirrorsWithoutPrimary: number;
    /** Mirrors whose rewrite failed. Their localStorage keys survive untouched. */
    failed: number;
    /** Outcome for the pre-ADR-0013 active document under `sourdaw-project`. */
    legacyActiveDocument: MirrorOutcome;
};

type MigrateOneMirrorInput = {
    mirrorKey: string;
    primaryKey: string;
    onMissingPrimary: () => void;
};

/**
 * Move one localStorage mirror into IndexedDB.
 *
 * The deletion rule, stated once: **a mirror is removed only when its own
 * rewrite has been observed to commit, or when a copy is confirmed to be equal
 * or newer.** "Confirmed" means both copies carried a readable
 * `meta.updatedAt`. A corrupt or timestamp-less primary confirms nothing, so it
 * never licenses a delete — that would be the read path's presence preference
 * rebuilt here, where the consequence is destruction rather than a stale load.
 */
async function migrateOneMirror({
    mirrorKey,
    primaryKey,
    onMissingPrimary,
}: MigrateOneMirrorInput): Promise<MirrorOutcome> {
    const mirror = readNamedProjectJsonFromLocalStorage(mirrorKey);
    if (mirror === null) {
        return 'absent';
    }

    let primary: string | null;
    try {
        primary = await readNamedProjectJsonFromIndexedDb(primaryKey);
    } catch (error) {
        logger.warn(`[migrateLegacyProjectSnapshots] Could not read ${primaryKey}; keeping the mirror:`, error);
        return 'failed';
    }

    if (primary === null) {
        onMissingPrimary();
    }

    if (primary !== null) {
        const { verdict, mirrorReadable } = compareProjectSnapshots({ primary, mirror });

        if (verdict === 'primary-newer-or-equal') {
            removeNamedProjectJsonFromLocalStorage(mirrorKey);
            return 'superseded';
        }

        if (verdict === 'indeterminate' && !mirrorReadable) {
            logger.warn(
                `[migrateLegacyProjectSnapshots] ${mirrorKey} is unreadable and cannot be compared; leaving both copies in place.`
            );
            return 'unresolved';
        }
    }

    try {
        await writeNamedProjectJsonByKey(primaryKey, mirror);
    } catch (error) {
        logger.warn(`[migrateLegacyProjectSnapshots] Rewrite failed for ${mirrorKey}; keeping the mirror:`, error);
        return 'failed';
    }

    removeNamedProjectJsonFromLocalStorage(mirrorKey);
    return 'recovered';
}

/**
 * Drain pre-ADR-0013 project content out of localStorage: the per-project
 * snapshots under `sourdaw:project:*` and the active document under
 * `sourdaw-project`. AC-1 is a state, not just a write behaviour — localStorage
 * must end up holding the recent-projects index and pointers only.
 *
 * Ordering is the whole point: read the mirror, write it through the observed
 * IndexedDB path, and only then remove the key. A mirror whose rewrite did not
 * commit is left exactly where it is, so a failed migration costs nothing and
 * retries on the next load.
 */
export async function migrateLegacyProjectSnapshots(): Promise<MigrateLegacyProjectSnapshotsOutput> {
    const keys = listLegacyProjectSnapshotKeys();
    const report: MigrateLegacyProjectSnapshotsOutput = {
        inspected: keys.length,
        recovered: 0,
        supersededByPrimary: 0,
        unresolved: 0,
        mirrorsWithoutPrimary: 0,
        failed: 0,
        legacyActiveDocument: 'absent',
    };

    function record(outcome: MirrorOutcome): void {
        if (outcome === 'recovered') {
            report.recovered++;
            return;
        }
        if (outcome === 'superseded') {
            report.supersededByPrimary++;
            return;
        }
        if (outcome === 'unresolved') {
            report.unresolved++;
            return;
        }
        if (outcome === 'failed') {
            report.failed++;
        }
    }

    for (const key of keys) {
        // Sequential by design: these transactions contend on one object store
        // and the count of failures is only meaningful if each one is observed.
        const outcome = await migrateOneMirror({
            mirrorKey: key,
            primaryKey: key,
            onMissingPrimary: () => {
                report.mirrorsWithoutPrimary++;
            },
        });
        record(outcome);
    }

    report.legacyActiveDocument = await migrateOneMirror({
        mirrorKey: LEGACY_PROJECT_STORAGE_KEY,
        primaryKey: ACTIVE_PROJECT_KEY,
        onMissingPrimary: () => undefined,
    });

    return report;
}
