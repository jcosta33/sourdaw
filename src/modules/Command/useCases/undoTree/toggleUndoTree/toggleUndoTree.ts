import { createEmptyTree, pushToTree, type UndoTree } from '../../../models/UndoTree';
import { undoStore } from '../../../stores/undoStore';
import { undoTreeStore } from '../../../stores/undoTree';

/**
 * Rebuild a fresh undo tree as a linear chain from the entries already on the `past`
 * stack, in chronological (oldest → newest) order. `currentNodeId` ends on the last
 * entry, matching the user's position. Returns an empty tree when there is no history.
 *
 * Used to retro-fill the tree when the undo tree is toggled on mid-session: `recordToTree`
 * only mirrors entries while the tree is enabled, so before this an already-edited session
 * produced an empty tree on enable, hiding every prior step (audit #7/#27).
 */
function rebuildTreeFromPast(): UndoTree {
    const past = undoStore.value?.past ?? [];
    let tree = createEmptyTree();
    for (const entry of past) {
        tree = pushToTree(tree, entry);
    }
    return tree;
}

export function toggleUndoTree(): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    const nextEnabled = !state.enabled;
    // Only rebuild on the false→true transition. Disabling leaves the tree intact so it
    // is preserved if re-enabled without intervening edits; re-enabling always re-derives
    // from the authoritative `past` stack rather than trusting a possibly-stale tree.
    const nextTree = nextEnabled ? rebuildTreeFromPast() : state.tree;
    undoTreeStore.set({ ...state, enabled: nextEnabled, tree: nextTree });
}
