import { workspaceStore } from '../stores/workspaceStore';

export function toggleRippleEditing(): void {
    const state = workspaceStore.value;
    if (!state) {
        return;
    }
    workspaceStore.set({ ...state, rippleEditing: !state.rippleEditing });
}
