import { projectStore } from '../../../stores/projectStore';

export function markDirty(): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
