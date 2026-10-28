import { inject } from '#/infra/di/inject';

import { setlistStore } from '../../stores/setlistStore';

import { applySetlistItemTransport } from './applySetlistItemTransport';
import { SetlistEventBus } from './setlistEventBus';

/**
 * Navigate to a specific setlist item by index.
 */
export const goToItem = inject({ eventBus: SetlistEventBus })(
    ({ eventBus: bus }) =>
        async function goToItem(index: number): Promise<void> {
            const state = setlistStore.value;
            if (!state || index < 0 || index >= state.items.length) {
                return;
            }

            setlistStore.set({ ...state, currentIndex: index });

            const item = state.items[index];
            if (!item) {
                return;
            }

            const isCurrent = (): boolean => {
                const current = setlistStore.value;
                const selectedItem = current?.items[current.currentIndex];
                if (!selectedItem || selectedItem.id !== item.id) {
                    return false;
                }
                return (
                    selectedItem.bpm === item.bpm &&
                    selectedItem.timeSignature?.numerator === item.timeSignature?.numerator &&
                    selectedItem.timeSignature?.denominator === item.timeSignature?.denominator &&
                    selectedItem.programChange?.channel === item.programChange?.channel &&
                    selectedItem.programChange?.program === item.programChange?.program
                );
            };
            await applySetlistItemTransport(item, isCurrent);

            if (isCurrent() && item.programChange) {
                void bus.emit('midi.out', {
                    type: 'programChange',
                    channel: item.programChange.channel,
                    program: item.programChange.program,
                });
            }
        }
);
