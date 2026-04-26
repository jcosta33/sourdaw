import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { setlistStore } from '../../stores/setlistStore';

/**
 * Navigate to a specific setlist item by index.
 */
export const goToItem = inject({ eventBus })(
    ({ eventBus: bus }) =>
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

            if (item.programChange) {
                void bus.emit('midi.out', {
                    type: 'programChange',
                    channel: item.programChange.channel,
                    program: item.programChange.program,
                });
            }
        }
);
