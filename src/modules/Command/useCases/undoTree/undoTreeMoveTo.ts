import { undoTreeStore } from '../../stores/undoTree';

/**
 * Move the undo tree's `currentNodeId` to the node whose entry is now the document's
 * position, after an `undo`/`redo` step.
 *
 * The tree is built by `pushToTree`, which parents each new node off `currentNodeId`.
 * Before this existed, `currentNodeId` only ever advanced on a new commit and never
 * walked back on undo/redo — so after an undo + new edit the fresh node was mis-parented
 * onto the last-pushed node instead of the user's actual position, collapsing branches
 * into a single chain (audit #46).
 *
 * `undo`/`redo` track position by the top of the `past` stack: the entry there is the
 * last applied edit, i.e. where the user "is". We mirror that onto the tree by finding
 * the node holding that entry. When `past` is empty the user is back at the root, so
 * `currentNodeId` becomes `null` (the same value a fresh tree carries) and the next
 * commit parents off nothing — exactly like the first-ever edit.
 *
 * No-ops when the tree is disabled or when the target entry has no node yet (e.g. the
 * tree was enabled mid-session and has not been retro-filled for this entry): moving to a
 * node that does not exist would strand `currentNodeId` on a dangling id.
 *
 * @param currentEntryId id of the undo entry now at the top of `past`, or `null` if the
 *   `past` stack is empty.
 */
export function undoTreeMoveTo(currentEntryId: string | null): void {
    const state = undoTreeStore.value;
    if (!state || !state.enabled) {
        return;
    }

    if (currentEntryId === null) {
        if (state.tree.currentNodeId === null) {
            return;
        }
        undoTreeStore.set({
            ...state,
            tree: { ...state.tree, currentNodeId: null },
        });
        return;
    }

    const targetNodeId = Object.keys(state.tree.nodes).find(
        (nodeId) => state.tree.nodes[nodeId]!.entry.id === currentEntryId
    );
    if (targetNodeId === undefined || targetNodeId === state.tree.currentNodeId) {
        return;
    }

    undoTreeStore.set({
        ...state,
        tree: { ...state.tree, currentNodeId: targetNodeId },
    });
}
