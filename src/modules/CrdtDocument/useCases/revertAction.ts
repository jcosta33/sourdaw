import { executeAppAction } from '#/modules/Command/useCases';

import { type ActionHistoryEntry, actionHistoryStore, markEntryReverted } from '../stores/actionHistoryStore';

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

    const entry = state.entries.find((e) => e.id === entryId);
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
    });

    markEntryReverted(entryId);
    return true;
}

/**
 * Check whether a history entry can be safely reverted.
 */
export const canRevertAction = (entry: ActionHistoryEntry): boolean => {
    if (entry.reverted) {
        return false;
    }
    if (!entry.inverseAction) {
        return false;
    }
    return true;
};
