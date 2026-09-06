import { type UndoEntry } from '../../models/UndoEntry';
import { createEmptyTree, pushToTree, type UndoTree } from '../../models/UndoTree';

/**
 * Rebuild a fresh undo tree as a linear chain from the entries already on the `past`
 * stack, in chronological (oldest → newest) order. `currentNodeId` ends on the last
 * entry, matching the user's position. Returns an empty tree when there is no history.
 *
 * `recordToTree` only mirrors entries while the tree is enabled, so a mirror emptied
 * by a `clearUndoHistory` (or missing because the tree was off) must be re-derived
 * from the authoritative `past` stack (audit #7/#27).
 */
export function rebuildTreeFromPast(past: readonly UndoEntry[]): UndoTree {
    let tree = createEmptyTree();
    for (const entry of past) {
        tree = pushToTree(tree, entry);
    }
    return tree;
}
