import { yeastStore } from '../stores/yeastStore';

/**
 * Project the `yeast` document slot into its store.
 *
 * Pure read (audit CC-2). Groove-assignment reconciliation used to run here,
 * which made the projection write the `grooveTemplates` slot in response to
 * `yeast` slot content — a second writer, and one that every peer would run
 * concurrently on the same inbound sync. It now runs at the mutation site
 * (`commitYeastProjection`), so the cleanup is authored once by the peer that
 * dropped the processor and converges to the others through the document.
 */
export function hydrateYeastCrdtProjection(): void {
    yeastStore.hydrate();
}
