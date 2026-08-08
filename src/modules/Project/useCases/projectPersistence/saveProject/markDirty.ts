import { projectStore } from '../../../stores/projectStore';

export function markDirty(): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    // A project being loaded is not being edited. Hydration writes the whole
    // arrangement, and store notification is deferred to the end of the load's
    // `batchStoreUpdates`, so without this guard every subscriber-driven dirty
    // mark fires after the load already published its clean metadata and the
    // freshly opened project claims unsaved changes (audit M-011). `loading`
    // stays true until the load's notifications have drained.
    if (state.loading) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
