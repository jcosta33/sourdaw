import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const renameSetlist = inject({ setlistStore })(({ setlistStore: store }) => {
    return function renameSetlist(name: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, name });
    };
});
