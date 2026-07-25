import { projectSlotProjections } from './projectSlotProjections';

type ProjectChangedCrdtSlotsInput = {
    /** Document slot keys the change touched. */
    readonly changedSlots: readonly string[];
    /**
     * `local-store` — a CRDT-backed store wrote these slots through the storage
     * adapter, which already holds their projected truth, so re-reading them is
     * pure cost (audit CC-1). Projections *derived* from those slots still run.
     * `document` — the change arrived from sync/merge/load, so every triggered
     * projection runs.
     */
    readonly origin: 'local-store' | 'document';
};

/**
 * Re-project only the slots a change actually touched.
 *
 * A local write to `tracks` used to re-hydrate all eighteen root slots, each
 * paying a `JSON.stringify` of its whole doc slot — cost proportional to the
 * project rather than to the edit (audit CC-1).
 */
export function projectChangedCrdtSlots({ changedSlots, origin }: ProjectChangedCrdtSlotsInput): void {
    if (changedSlots.length === 0) {
        return;
    }

    const changed = new Set(changedSlots);
    for (const projection of projectSlotProjections) {
        const hasTrigger = projection.triggerSlots.some((trigger) => {
            if (origin === 'local-store' && trigger === projection.slot) {
                return false;
            }
            return changed.has(trigger);
        });
        if (hasTrigger) {
            projection.hydrate();
        }
    }
}
