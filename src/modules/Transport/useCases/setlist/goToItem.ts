import { setlistStore } from '#/modules/Transport/stores/setlistStore';
import { eventBus } from '#/app/registerDependencies';

/**
 * Navigate to a specific setlist item by index.
 */
export function goToItem(index: number): void {
    const state = setlistStore.value;
    if (!state || index < 0 || index >= state.items.length) {
        return;
    }

    setlistStore.set({ ...state, currentIndex: index });

    const item = state.items[index];
    if (!item) {
        return;
    }

    // Dispatch program change if configured
    if (item.programChange) {
        void eventBus.emit('midi.out', { type: 'programChange', channel: item.programChange.channel, program: item.programChange.program });
    }
}
