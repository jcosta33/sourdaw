import { inject } from '#/infra/di/inject';
import { setlistStore, type SetlistItem } from '#/modules/Transport/stores/setlistStore';
import { getNextSetlistItemId, SETLIST_ITEM_COLORS } from '../../repositories/setlistItemIdCounter';

export const addSetlistItem = inject({ setlistStore, getNextSetlistItemId, SETLIST_ITEM_COLORS })(
    ({ setlistStore: store, getNextSetlistItemId: nextId, SETLIST_ITEM_COLORS: colors }) => {
        return function addSetlistItem(name: string, estimatedDuration: number = 180): void {
            const state = store.value;
            if (!state) {
                return;
            }

            const item: SetlistItem = {
                id: nextId(),
                name,
                projectPath: null,
                bpm: null,
                timeSignature: null,
                estimatedDuration,
                notes: '',
                programChange: null,
                color: colors[state.items.length % colors.length]!,
                autoStop: true,
                gapSeconds: 2,
                markers: [],
            };

            store.set({
                ...state,
                items: [...state.items, item],
                totalDuration: state.totalDuration + estimatedDuration,
            });
        };
    }
);
