import { executeAppAction } from '#/modules/Command/useCases';

import { actionHistoryStore, markEntryReverted } from '../../stores/actionHistoryStore';

/**
 * Revert a specific historical action by applying its inverse at the current head.
 *
 * This is non-linear compensating undo — it doesn't rewind the document,
 * it applies a new change that reverses the effect of the original action.
 * Unrelated later edits are preserved.
 *
 * Returns true if the revert was applied, false if it can't be safely reverted.
 */
export async function revertAction(entryId: string): Promise<boolean> {
    const state = actionHistoryStore.value;
    if (!state) {
        return false;
    }

    const entry = state.entries.find((event) => event.id === entryId);
    if (!entry) {
        return false;
    }

    if (entry.reverted) {
        return false;
    }

    if (!entry.inverseAction) {
        return false;
    }

    await executeAppAction(entry.inverseAction, {
        source: entry.source,
        groupLabel: `Reverted: ${entry.label}`,
        skipMacroRecording: true,
    });

    markEntryReverted(entryId);
    return true;
}
