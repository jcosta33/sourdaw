import { type UndoEntry } from '../models/UndoEntry';
import { pushUndo } from '../stores/undoStore';

import { recordToTree } from './undoTree/recordToTree';

/**
 * §8.1 — Push an undo entry AND mirror it into the branching undo tree.
 * Previously the tree-recording side effect lived inside the store's
 * `pushUndo` setter, which made the store import a useCase (anti-pattern).
 * All callers that want the full "commit" semantics route through this
 * useCase; the raw `pushUndo` setter is now purely a state mutation.
 */
export function commitUndoEntry(entry: UndoEntry): void {
    pushUndo(entry);
    recordToTree(entry);
}
