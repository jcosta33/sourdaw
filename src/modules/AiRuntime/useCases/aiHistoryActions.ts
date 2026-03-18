/**
 * AI History Actions — use case for reverting AI action groups.
 *
 * Wraps cross-module Command store and use case access so that
 * AiActionHistoryPanel.tsx doesn't import them directly.
 */

import { undoStore } from '#/modules/Command/stores/undoStore';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
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
