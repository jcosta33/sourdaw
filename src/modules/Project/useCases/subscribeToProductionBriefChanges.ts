import { projectStore } from '../stores/projectStore';

/**
 * Calls `listener` when the project's production brief is replaced, not on any
 * other project store write. `projectStore` publishes on every field change, so
 * the brief's identity is what separates a lock change from a rename.
 */
export function subscribeToProductionBriefChanges(listener: () => void): () => void {
    let brief = projectStore.value?.productionBrief;
    return projectStore.subscribe((state) => {
        const next = state?.productionBrief;
        if (next === brief) {
            return;
        }
        brief = next;
        listener();
    });
}
