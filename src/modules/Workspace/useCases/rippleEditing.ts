import { inject } from '#/infra/di/inject';
import { workspaceStore } from '../stores/workspaceStore';

export const toggleRippleEditing = inject({ workspaceStore })(
    ({ workspaceStore }) =>
        function toggleRippleEditing(): void {
            const state = workspaceStore.value;
            if (!state) {
                return;
            }
            workspaceStore.set({ ...state, rippleEditing: !state.rippleEditing });
        }
);
