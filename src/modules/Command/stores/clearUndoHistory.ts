import { createEmptyTree } from '../models/UndoTree';

import { clearUndoStoreOwner, undoStore } from './undoStore';
import { undoTreeStore } from './undoTree';

/**
 * Drops the live stacks and their project/document tag together. Every
 * in-session project transition (new project, template, arrangement switch,
 * branch switch) calls this: dropping the tag too keeps a later mirror flush
 * from attributing untouched stacks to the project it just left. See
 * `Command/AGENTS.md` for the accepted incompleteness this trades for safety.
 *
 * Also resets the branching tree mirror to an empty tree: `pushToTree` parents
 * each new node off `currentNodeId`, so a cursor left on the cleared history
 * chains the next history's first push onto a dead node. `enabled` is the
 * user's tree preference rather than history, so it survives the clear.
 */
export function clearUndoHistory(): void {
    clearUndoStoreOwner();
    undoStore.set({ past: [], future: [] });
    const undoTreeState = undoTreeStore.value;
    if (undoTreeState) {
        undoTreeStore.set({ ...undoTreeState, tree: createEmptyTree() });
    }
}
