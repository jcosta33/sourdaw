import { undoStore } from '../stores/undoStore';

import { revertUndoEntriesAtomically } from './revertUndoEntriesAtomically';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/**
 * Revert every undo entry tagged with `groupId`, owning the undo-store write
 * inside the Command module. Used by AiRuntime to revert an AI action group
 * without reconstructing the past/future split — and the undo-tree position —
 * by hand. The entries are undone newest-first, removed from `past`, and pushed
 * onto `future` so a redo re-applies them in order.
 */
export async function revertActionGroup(groupId: string): Promise<boolean> {
    const state = undoStore.value;
    if (!state) {
        return false;
    }

    const groupEntries = state.past.filter((entry) => entry.groupId === groupId);
    if (groupEntries.length === 0) {
        return false;
    }

    const reverted = await revertUndoEntriesAtomically(groupEntries);
    if (!reverted) {
        return false;
    }

    const newPast = state.past.filter((entry) => entry.groupId !== groupId);
    undoStore.set({
        past: newPast,
        future: [...groupEntries, ...state.future],
    });
    undoTreeMoveTo(newPast.length > 0 ? newPast[newPast.length - 1]!.id : null);
    return true;
}
