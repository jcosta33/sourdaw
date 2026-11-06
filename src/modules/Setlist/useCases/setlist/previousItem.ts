import { setlistStore } from '../../stores/setlistStore';

import { goToItem } from './goToItem';

export async function previousItem(): Promise<void> {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    await goToItem(state.currentIndex - 1);
}
