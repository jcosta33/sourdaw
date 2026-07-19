import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';
import { executeAppActionImpl } from './executeAppActionImpl';
import { revertUndoEntriesAtomically } from './revertUndoEntriesAtomically';
import { runCommandHistoryReplay } from './runCommandHistoryReplay';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

type ExecuteUndoInput = {
    entry: UndoEntry;
    owner: CommandMutationOwner;
};

async function executeUndo({ entry, owner }: ExecuteUndoInput): Promise<boolean> {
    if (entry.kind === 'callback') {
        await runCommandHistoryReplay(owner, entry.undo);
        return true;
    }
    if (entry.inverseAction) {
        await executeAppActionImpl(
            entry.inverseAction,
            {
                skipUndo: true,
                skipMacroRecording: true,
            },
            owner
        );
        return true;
    }
    return false;
}

/** Execute one undo while the caller already owns the Command mutation lease. */
export async function undoUnderMutation(owner?: CommandMutationOwner): Promise<void> {
    const mutationOwner = owner ?? commandMutationRuntime.synchronousOwner ?? commandMutationRuntime.activeOwner;
    if (!mutationOwner) {
        throw new Error('Undo requires an active Command mutation owner');
    }
    const state = undoStore.value;
    if (!state || state.past.length === 0) {
        return;
    }

    const lastEntry = state.past[state.past.length - 1]!;

    if (lastEntry.transactionGroupId) {
        const groupEntries: UndoEntry[] = [];
        let index = state.past.length - 1;
        while (index >= 0 && state.past[index]!.transactionGroupId === lastEntry.transactionGroupId) {
            groupEntries.unshift(state.past[index]!);
            index--;
        }
        const newPast = state.past.slice(0, index + 1);

        const undone = await revertUndoEntriesAtomically(mutationOwner, groupEntries);
        if (!undone) {
            return;
        }

        undoStore.set({
            past: newPast,
            future: [...groupEntries, ...state.future],
        });
        undoTreeMoveTo(currentEntryId(newPast));
        return;
    }

    const undone = await executeUndo({
        entry: lastEntry,
        owner: mutationOwner,
    });
    if (!undone) {
        return;
    }

    const newPast = state.past.slice(0, -1);
    undoStore.set({
        past: newPast,
        future: [lastEntry, ...state.future],
    });
    undoTreeMoveTo(currentEntryId(newPast));
}
