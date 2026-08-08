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
    // being cleared. Both load paths clear it (`replaceProjectData` via
    // `finishProjectLoading`, `loadProject` after its batch), but the *abort*
    // paths in `replaceProjectData` return without restoring it — a pre-existing
    // gap, not one this guard introduced, and one that already left the app
    // showing its loading overlay. If it is ever fixed by leaving `loading`
    // true, edits after a failed load would stop marking dirty; the fix is to
    // restore the flag on abort, not to weaken this guard.
    if (state.loading) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
