import { undoTreeStore } from '../../../stores/undoTree';

/**
 * Record which child branch is active at a fork node.
 *
 * SCOPE — branch *selection* only, not branch *traversal*. This records the user's choice
 * of active branch on the fork node; it deliberately does NOT move `currentNodeId`, replay
 * the selected branch forward, or invert the abandoned branch. The document position is
 * unchanged by calling this.
 *
 * Why not traverse here: moving `currentNodeId` to the selected branch without also
 * replaying that branch's actions (and inverting the old branch's) would desync the tree's
 * recorded position from the actual document state — strictly worse than the inert
 * selection this performs. Correct traversal needs an async path-replay engine that walks
 * from the current node back to the fork (inverting each step) and down the new branch
 * (re-executing each step) while keeping `undoStore.past/future` consistent. That engine
 * spans the undo runtime (`useCases/undoRedo.ts`) and `executeAppAction`, is asynchronous,
 * and is out of scope for this function — which has no callers wiring it to traversal
 * today (audit #46 / Unknowns). Until that engine exists, undo-tree branch switching is a
 * presentation-only affordance: this setter is the seam it will build on, and the active
 * branch it records is exactly the path a traversal engine would replay.
 */
export function switchBranch(forkNodeId: string, branchIndex: number): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    const node = state.tree.nodes[forkNodeId];
    if (!node || branchIndex < 0 || branchIndex >= node.children.length) {
        return;
    }
    undoTreeStore.set({
        ...state,
        tree: {
            ...state.tree,
            nodes: {
                ...state.tree.nodes,
                [forkNodeId]: { ...node, activeBranch: branchIndex },
            },
        },
    });
}
