import { setlistStore } from '#/modules/Transport/stores/setlistStore';
import { goToItem } from './goToItem';

export function nextItem(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    goToItem(state.currentIndex + 1);
}
