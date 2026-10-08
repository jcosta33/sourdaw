/**
 * Per-device bookkeeping that guards the Crumbs sample door and its document
 * mirror. Session-lifecycle state, not project truth — the same pattern as the
 * Levain bridge's per-device load sequences and the preview bookkeeping in
 * `crumbsStore.ts`.
 *
 * Two guards, one failure shape each:
 *
 * - The load sequence makes the sample door last-started-wins. Decodes race:
 *   without an epoch the last-FINISHING load wins the store and the document,
 *   so a peer's long file finishing after the local user's short pick silently
 *   reverts the pick. `loadSampleFromPath` begins each load with a sequence
 *   and applies its result only while it is still the latest-started one.
 *
 * - The paired-reconcile hold keeps the persistence mirror quiet while a
 *   reconcile-initiated mode+sample pair is unsettled. The mode lands
 *   synchronously beside the store's still-stale `activeSample`; committing
 *   that state would mirror the stale sample over the peer's document
 *   reference, and a failed or slow decode then erases the reference
 *   cross-session (#4764).
 *
 * Concurrent paired reconciles for one device nest: the hold is a per-device
 * count and releases only when the LAST of them settles, so the first settle
 * of a collapsed pair cannot expose the second's mid-pair state to the mirror.
 * The last release is the pair's convergence point: the reconciler ends the
 * hold and replays the persistence comparison against the settled store
 * (`replayCrumbsDeviceStateCommit`), so the settled state reaches the document
 * even when no further store write ever comes.
 */

const latestSampleLoadSequences = new Map<string, number>();
let nextSampleLoadSequence = 0;

const unsettledPairedReconciles = new Map<string, number>();

/** Begin a sample load for a device and return its start-order sequence. */
export function beginCrumbsSampleLoad(instanceId: string): number {
    const sequence = ++nextSampleLoadSequence;
    latestSampleLoadSequences.set(instanceId, sequence);
    return sequence;
}

/** Whether this sequence is still the device's most-recently-started load. */
export function isLatestCrumbsSampleLoad(instanceId: string, sequence: number): boolean {
    return latestSampleLoadSequences.get(instanceId) === sequence;
}

/**
 * Hold the persistence mirror for a reconcile's paired mode+sample apply.
 * Concurrent holds for one device nest.
 */
export function beginCrumbsPairedReconcile(instanceId: string): void {
    unsettledPairedReconciles.set(instanceId, (unsettledPairedReconciles.get(instanceId) ?? 0) + 1);
}

/**
 * Release one hold once its paired load has settled (resolved or rejected).
 * The mirror stays held while a younger paired reconcile for the device is
 * still unsettled.
 */
export function endCrumbsPairedReconcile(instanceId: string): void {
    const remaining = (unsettledPairedReconciles.get(instanceId) ?? 0) - 1;
    if (remaining > 0) {
        unsettledPairedReconciles.set(instanceId, remaining);
        return;
    }
    unsettledPairedReconciles.delete(instanceId);
}

/** Whether a reconcile's paired mode+sample apply is still unsettled. */
export function hasUnsettledCrumbsPairedReconcile(instanceId: string): boolean {
    return unsettledPairedReconciles.has(instanceId);
}
