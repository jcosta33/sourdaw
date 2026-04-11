import { undoTreeStore } from '../../../stores/undoTree';

export function toggleUndoTree(): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    undoTreeStore.set({ ...state, enabled: !state.enabled });
}