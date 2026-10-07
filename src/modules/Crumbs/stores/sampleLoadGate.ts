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
 * Concurrent paired reconciles for one device collapse: the Set holds the
 * device id until the first settle releases it. That is safe because the
 * load-sequence guard above orders the store writes (only the latest load
 * applies) and the persistence baseline stays at the last committed key, so
 * the next unsuppressed pass commits the full settled state.
 */

const latestSampleLoadSequences = new Map<string, number>();
let nextSampleLoadSequence = 0;

const unsettledPairedReconciles = new Set<string>();

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

/** Hold the persistence mirror for a reconcile's paired mode+sample apply. */
export function beginCrumbsPairedReconcile(instanceId: string): void {
    unsettledPairedReconciles.add(instanceId);
}

/** Release the hold once the paired load has settled (resolved or rejected). */
export function endCrumbsPairedReconcile(instanceId: string): void {
    unsettledPairedReconciles.delete(instanceId);
}

/** Whether a reconcile's paired mode+sample apply is still unsettled. */
export function hasUnsettledCrumbsPairedReconcile(instanceId: string): boolean {
    return unsettledPairedReconciles.has(instanceId);
}
