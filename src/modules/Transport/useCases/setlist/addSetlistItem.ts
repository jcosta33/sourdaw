import { setlistStore, type SetlistItem } from '#/modules/Transport/stores/setlistStore';
import { getNextSetlistItemId, SETLIST_ITEM_COLORS } from '#/modules/Transport/models/setlistItemHelpers';

export function addSetlistItem(name: string, estimatedDuration: number = 180): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }

    const item: SetlistItem = {
        id: getNextSetlistItemId(),
        name,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration,
        notes: '',
        programChange: null,
        color: SETLIST_ITEM_COLORS[state.items.length % SETLIST_ITEM_COLORS.length]!,
        autoStop: true,
        gapSeconds: 2,
        markers: [],
    };

    setlistStore.set({
        ...state,
        items: [...state.items, item],
        totalDuration: state.totalDuration + estimatedDuration,
    });
}
