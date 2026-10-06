import { DOC_PREFIX_ROOT, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

import { reconcileGrandBouleDevicesFromProject } from './reconcileGrandBouleDevicesFromProject';

/**
 * Reconcile the per-device Grand Boule stores whenever project truth changes
 * under them (#4894).
 *
 * A remote peer's device-state commit lands through the CRDT without ever
 * re-running an app action, and undo and bulk operations rewrite the document
 * the same way, so the local triggers (`commitGrandBouleDeviceState`, the
 * `setGrandBouleDeviceState` handler's commit effects, `audioDevice.loaded`)
 * never fire for them: a session that had already loaded the device kept
 * playing, showing and exporting its stale voicing and temperament until
 * reload. This subscription re-runs `reconcileGrandBouleDeviceStateFromProject`
 * for each device on every change to the project document — the same
 * reconciliation a local commit performs, so a peer's temperament 5 wins over
 * the stale store exactly as the user's own commit would.
 *
 * The repository's local-write hint (`localSlots`) is not visible through the
 * public `subscribeToCrdtChanges` seam, so a change a local CRDT-backed store
 * wrote triggers this path too. That is harmless rather than redundant work:
 * after the local commit the store and the document agree, so the hydrate's
 * diff gate leaves the store untouched, and the ready engine is re-pushed with
 * the values it already holds through the same `setTemperament`/`setParam`
 * doors a panel pick uses.
 *
 * A transient morph drag holds store state the document has not committed
 * (`dispatchGrandBouleMorphEdit`'s `isTransient` half) and exposes no in-flight
 * signal a subscription could honour, so the document stays the authority: a
 * change landing mid-drag reconciles across the preview, the next pointer move
 * reapplies it, and the release re-commits it (#4894).
 */
export function initGrandBouleDocumentReconciliation(): () => void {
    let subscribed = true;
    let sweepScheduled = false;
    const unsubscribe = subscribeToCrdtChanges((docId) => {
        // Project stores live in the root document, the same filter the
        // projection bridge applies: a specific other doc id is a branch
        // snapshot or `__branches__` and backs no project store, while
        // `undefined` marks a bulk operation (load / merge / snapshot) that
        // always reconciles.
        if (docId !== undefined && docId !== DOC_PREFIX_ROOT) {
            return;
        }
        if (sweepScheduled) {
            return;
        }
        sweepScheduled = true;
        // Deferred one microtask so the sweep reads the track store after the
        // projection bridge has re-projected this same change into it: this
        // registers at bootstrap, the bridge at session start, and listeners
        // run in registration order. The guard also collapses a burst of
        // notifications into one pass instead of one per document write.
        queueMicrotask(() => {
            sweepScheduled = false;
            if (!subscribed) {
                return;
            }
            reconcileGrandBouleDevicesFromProject();
        });
    });
    return () => {
        subscribed = false;
        unsubscribe();
    };
}
