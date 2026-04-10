import { inject } from '#/infra/di/inject';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

export const flattenComp = inject({ takeLaneStore })(({ takeLaneStore: store }) => {
    return function flattenComp(trackId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        store.set({
            lanes: state.lanes.filter((l) => l.trackId !== trackId),
        });
    };
});
