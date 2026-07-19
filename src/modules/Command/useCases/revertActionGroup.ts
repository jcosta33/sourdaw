import { undoStore } from '../stores/undoStore';

import { runCommandMutationExclusive } from './commandMutation';
import { type CommandMutationOwner } from './commandMutationOwner';
import { revertUndoEntriesAtomically } from './revertUndoEntriesAtomically';
import { rebuildUndoTreeFromHistory } from './undoTree/rebuildUndoTreeFromHistory';

/**
 * Revert every undo entry tagged with `groupId`, owning the undo-store write
 * inside the Command module. Used by AiRuntime to revert an AI action group
 * without reconstructing the past/future split — and the undo-tree position —
 * by hand. The entries are undone newest-first, removed from `past`, and pushed
 * onto `future` so a redo re-applies them in order.
 */
async function revert_action_group(owner: CommandMutationOwner, groupId: string): Promise<boolean> {
    const state = undoStore.value;
    if (!state) {
        return false;
    }

    const groupEntries = state.past.filter((entry) => entry.groupId === groupId);
    if (groupEntries.length === 0) {
        return false;
    }

    const reverted = await revertUndoEntriesAtomically(owner, groupEntries);
    if (!reverted) {
        return false;
    }

    const newPast = state.past.filter((entry) => entry.groupId !== groupId);
    const reverted_entries =
        groupEntries.length > 1
            ? groupEntries.map((entry) => ({ ...entry, transactionGroupId: groupId }))
            : groupEntries;
    const nextHistory = {
        past: newPast,
        future: [...reverted_entries, ...state.future],
    };
    undoStore.set(nextHistory);
    rebuildUndoTreeFromHistory(nextHistory);
    return true;
}

export function revertActionGroup(groupId: string): Promise<boolean> {
    return runCommandMutationExclusive((owner) => revert_action_group(owner, groupId));
}
