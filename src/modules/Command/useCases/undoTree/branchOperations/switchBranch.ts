import { undoTreeStore } from '../../../stores/undoTree';

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
