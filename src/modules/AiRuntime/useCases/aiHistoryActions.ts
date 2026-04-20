import { undoStore } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { type AiActionGroup, markGroupReverted } from '../stores/aiActionHistoryStore';

export async function revertAiActionGroup(group: AiActionGroup): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const groupEntries = state.past.filter((e) => e.groupId === group.groupId);
    for (let i = groupEntries.length - 1; i >= 0; i--) {
        const entry = groupEntries[i]!;
        if (entry.kind === 'callback') {
            entry.undo();
        } else if (entry.inverseAction) {
            await executeAppAction(entry.inverseAction);
        }
    }

    undoStore.set({
        past: state.past.filter((e) => e.groupId !== group.groupId),
        future: [...groupEntries, ...state.future],
    });

    markGroupReverted(group.groupId);
}
