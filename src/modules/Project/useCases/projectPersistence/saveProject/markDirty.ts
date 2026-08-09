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
    //
    // Provenance / known edge: this makes dirty tracking depend on `loading`
    // being cleared, so anything that can leave it set disables editing
    // detection for the rest of the session. The load paths clear it
    // (`replaceProjectData` via `finishProjectLoading` in a `finally`,
    // `loadProject` after its batch) and `replaceProjectData`'s eight abort
    // returns hand the previous session's value back, the way `newProject`'s
    // `failNewProjectActivation` does. What is still open: both restore the
    // value captured on *entry*, so a transition that begins while an earlier
    // load already holds `loading: true` restores `loading: true` on abort.
    // The fix for that is a better capture, not a weaker guard here.
    if (state.loading) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
