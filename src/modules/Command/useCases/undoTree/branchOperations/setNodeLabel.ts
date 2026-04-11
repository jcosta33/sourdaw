import { undoTreeStore } from '../../../stores/undoTree';
import { labelBranch } from '../../../models/UndoTree';

export function setNodeLabel(nodeId: string, label: string): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    undoTreeStore.set({
        ...state,
        tree: labelBranch(state.tree, nodeId, label),
    });
}