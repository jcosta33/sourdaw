import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { getNextSetlistItemId, SETLIST_ITEM_COLORS } from '../../repositories/setlistItemIdCounter';
import { setlistStore, type SetlistItem, type SetlistState } from '../../stores/setlistStore';

export function addSetlistItem(name: string, estimatedDuration: number = 180): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
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

        const previous: SetlistState = state;
        const next: SetlistState = {
            ...state,
            items: [...state.items, item],
            totalDuration: state.totalDuration + estimatedDuration,
        };
        setlistStore.set(next);

        pushUndoEntry(
            `Add setlist item: ${name}`,
            () => setlistStore.set(previous),
            () => setlistStore.set(next)
        );
    });
}
