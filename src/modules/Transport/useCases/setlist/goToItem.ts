import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';
import { eventBus } from '#/app/registerDependencies';

/**
 * Navigate to a specific setlist item by index.
 */
export const goToItem = inject({ eventBus })(
    ({ eventBus }) =>
        function goToItem(index: number): void {
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
                eventBus.emit('midi.out', {
                    type: 'programChange',
                    channel: item.programChange.channel,
                    program: item.programChange.program,
                });
            }
        }
);
