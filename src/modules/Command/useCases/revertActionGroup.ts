import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/**
 * Undo a single undo entry, returning whether anything was actually undone. An
 * action entry with no `inverseAction` cannot be undone — see `undoRedo`'s
 * `executeUndo` for why a non-undoable entry must not be consumed.
 *
 * `skipUndo: true` is load-bearing: the inverse is a replay driven by the undo
 * engine, not a fresh user edit, so it must not commit its own undo entry.
 */
async function revertEntry(entry: UndoEntry): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        await executeAppAction(entry.inverseAction, { skipUndo: true });
        return true;
    }
    return false;
}

/**
 * Revert every undo entry tagged with `groupId`, owning the undo-store write
 * inside the Command module. Used by AiRuntime to revert an AI action group
 * without reconstructing the past/future split — and the undo-tree position —
 * by hand. The entries are undone newest-first, removed from `past`, and pushed
 * onto `future` so a redo re-applies them in order.
 */
export async function revertActionGroup(groupId: string): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const groupEntries = state.past.filter((entry) => entry.groupId === groupId);
    if (groupEntries.length === 0) {
        return;
    }

    let anyReverted = false;
    for (let index = groupEntries.length - 1; index >= 0; index--) {
        const reverted = await revertEntry(groupEntries[index]!);
        anyReverted = anyReverted || reverted;
    }

    // If no member could be undone, the operation was inert — leave the group in
    // `past` rather than silently consuming it (which would let a later redo
    // re-apply the actions). Mirrors the inert-undo guard in `undoRedo`.
    if (!anyReverted) {
        return;
    }

    const newPast = state.past.filter((entry) => entry.groupId !== groupId);
    undoStore.set({
        past: newPast,
        future: [...groupEntries, ...state.future],
    });
    undoTreeMoveTo(newPast.length > 0 ? newPast[newPast.length - 1]!.id : null);
}
