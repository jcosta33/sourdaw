import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/**
 * Undo a single undo entry, returning whether anything was actually undone. An
 * action entry with no `inverseAction` cannot be undone — see `undoRedo`'s
 * `executeUndo` for why a non-undoable entry must not be consumed.
 *
 * The inverse is an internal replay driven by the undo engine, so it must not
 * commit its own undo entry or appear in an active macro recording.
 */
async function revertEntry(entry: UndoEntry): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        await executeAppAction(entry.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        return true;
    }
    return false;
}

function commitRevertedEntries(entries: readonly UndoEntry[]): void {
    const liveState = undoStore.value;
    if (!liveState || entries.length === 0) {
        return;
    }
    const revertedIds = new Set(entries.map((entry) => entry.id));
    const past = liveState.past.filter((entry) => !revertedIds.has(entry.id));
    undoStore.set({ past, future: [...entries, ...liveState.future] });
    undoTreeMoveTo(past.length > 0 ? past[past.length - 1]!.id : null);
}

/**
 * Revert every undo entry tagged with `groupId`, owning the undo-store write
 * inside the Command module. Used by AiRuntime to revert an AI action group
 * without reconstructing the past/future split — and the undo-tree position —
 * by hand. The entries are undone newest-first, removed from `past`, and pushed
 * onto `future` so a redo re-applies them in order.
 */
async function revertActionGroupImpl(groupId: string): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const groupEntries = state.past.filter((entry) => entry.groupId === groupId);
    if (groupEntries.length === 0) {
        return;
    }

    const revertedEntries: UndoEntry[] = [];
    let failure: unknown;
    for (let index = groupEntries.length - 1; index >= 0; index--) {
        const entry = groupEntries[index]!;
        try {
            if (await revertEntry(entry)) {
                revertedEntries.unshift(entry);
            }
        } catch (error) {
            failure = error;
            break;
        }
    }

    commitRevertedEntries(revertedEntries);
    if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error('Action group revert failed', { cause: failure });
    }
}

export function revertActionGroup(groupId: string): Promise<void> {
    return runUndoRedoExclusive(() => revertActionGroupImpl(groupId));
}
