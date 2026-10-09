import { DOC_PREFIX_ROOT, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';
import { reconcileCrumbsDeviceStatesFromProject } from '#/modules/Crumbs/useCases';
import { reconcileLevainDeviceStatesFromProject } from '#/modules/Levain/useCases';
import { reconcileToasterKitsFromProject } from '#/modules/Toaster/useCases';

/**
 * Re-run the Toaster, Levain and Crumbs device sweeps on every change to the
 * project document (#4764).
 *
 * A remote peer's device-state commit lands through the CRDT without ever
 * re-running an app action, and undo and bulk operations rewrite the document
 * the same way, so the modules' local triggers (their persistence
 * subscribers, device registration) never fire for them: a session that had
 * already loaded a device kept playing, showing and rendering its stale
 * deviceState until reload — and its next local edit committed the stale
 * store over the peer's change. This subscription re-runs each owner's sweep
 * on every project-document change, mirroring
 * `initGrandBouleDocumentReconciliation` (#4894). It lives in the app seam,
 * beside the Grand Boule twin, because the per-device reconciles reach their
 * engine doors (and the Toaster and Levain barrels are one CrdtDocument-edge
 * away from closing `no-circular` cycles through AudioEngine) — the sweep
 * functions the modules export carry no document-domain imports at all.
 *
 * A change to a document that backs no project store is ignored: a specific
 * other doc id is a branch snapshot or `__branches__`, while `undefined`
 * marks a bulk operation (load / merge / snapshot) that always reconciles —
 * the same filter the projection bridge applies.
 *
 * The sweep is deferred one microtask so it reads the track store after the
 * projection bridge has re-projected this same change into it — this
 * registers at bootstrap, the bridge at session start, and listeners run in
 * registration order — and the guard collapses a burst of notifications into
 * one pass instead of one sweep per document write.
 */
export function initDeviceStateReconciliation(): () => void {
    let subscribed = true;
    let sweepScheduled = false;
    const unsubscribe = subscribeToCrdtChanges((docId) => {
        if (docId !== undefined && docId !== DOC_PREFIX_ROOT) {
            return;
        }
        if (sweepScheduled) {
            return;
        }
        sweepScheduled = true;
        queueMicrotask(() => {
            sweepScheduled = false;
            if (!subscribed) {
                return;
            }
            reconcileToasterKitsFromProject();
            reconcileLevainDeviceStatesFromProject();
            reconcileCrumbsDeviceStatesFromProject();
        });
    });
    return () => {
        subscribed = false;
        unsubscribe();
    };
}
