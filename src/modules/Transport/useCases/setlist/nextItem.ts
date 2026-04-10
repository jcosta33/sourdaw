import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';
import { goToItem } from './goToItem';

export const nextItem = inject({ setlistStore, goToItem })(({ setlistStore: store, goToItem: goToItemFn }) => {
    return function nextItem(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        goToItemFn(state.currentIndex + 1);
    };
});
