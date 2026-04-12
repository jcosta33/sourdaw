import { setlistStore } from '../../stores/setlistStore';
import { goToItem } from './goToItem';

export function previousItem(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    goToItem(state.currentIndex - 1);
}
