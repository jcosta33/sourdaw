import { type UndoEntry } from '../models/UndoEntry';
import { pushToTree } from '../models/UndoTree';
import { pushUndoEntries } from '../stores/undoStore';
import { undoTreeStore } from '../stores/undoTree';

export function commitUndoEntries(entries: readonly UndoEntry[]): void {
    pushUndoEntries(entries);
    const state = undoTreeStore.value;
    if (!state?.enabled) {
        return;
    }
    undoTreeStore.set({
        ...state,
        tree: entries.reduce(pushToTree, state.tree),
    });
}
