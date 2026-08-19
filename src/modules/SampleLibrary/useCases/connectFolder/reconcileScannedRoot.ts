import { type SampleRecord } from '../../models/LibraryTypes';
import { addSamples, libraryStore, removeSamples } from '../../stores/libraryStore';

/**
 * Reconcile the store's persisted view of a root against a completed scan.
 *
 * `scanned` maps each currently-present sample id to its freshly-built record
 * (carrying the on-disk mtime where the provider exposes it). The reconcile:
 *  - removes records whose backing file is gone (a deletion the add-only scan
 *    could never surface);
 *  - replaces records whose mtime changed since last scan (an in-place edit the
 *    deterministic-id dedup would otherwise hide behind stale metadata).
 * New files were already added during streaming, so they need no action here.
 *
 * It must only run after a *complete* scan: a scan that was aborted or skipped
 * unreadable directories has not observed the full file set, and pruning then
 * would delete live samples. The `complete` guard enforces that.
 */
export function reconcileScannedRoot(rootId: string, scanned: Map<string, SampleRecord>, complete: boolean): void {
    if (!complete) {
        return;
    }
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    const orphanIds: string[] = [];
    const changed: SampleRecord[] = [];
    for (const stored of state.samples) {
        if (stored.libraryRootId !== rootId) {
            continue;
        }
        const fresh = scanned.get(stored.id);
        if (!fresh) {
            orphanIds.push(stored.id);
            continue;
        }
        // Replace only when both sides expose an mtime and it moved. Undefined
        // mtime (provider can't stat, e.g. native readDir) is treated as "no
        // change signal" so we never churn records we can't compare.
        const freshMtime = fresh.sync.mtimeMs;
        const storedMtime = stored.sync.mtimeMs;
        if (freshMtime !== undefined && storedMtime !== undefined && freshMtime !== storedMtime) {
            changed.push(fresh);
        }
    }

    if (orphanIds.length > 0) {
        removeSamples(orphanIds);
    }
    if (changed.length > 0) {
        // Drop the stale records then re-add the fresh ones (addSamples dedups
        // by id, so the remove must precede the add).
        removeSamples(changed.map((sample) => sample.id));
        addSamples(changed);
    }
}
