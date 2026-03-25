import { undoTreeStore } from '../../stores/undoTree';
import { type UndoTree, getCurrentPath, getForwardPath, countBranches, getBranchPoints } from '../../models/UndoTree';

export function getUndoTree(): UndoTree | null {
    return undoTreeStore.value?.tree ?? null;
}

export function getTreeStats(): { totalNodes: number; branches: number; depth: number } {
    const tree = undoTreeStore.value?.tree;
    if (!tree) { return { totalNodes: 0, branches: 0, depth: 0 }; }
    return {
        totalNodes: Object.keys(tree.nodes).length,
        branches: countBranches(tree),
        depth: getCurrentPath(tree).length,
    };
}

export function getTreeBranchPoints() {
    const tree = undoTreeStore.value?.tree;
    if (!tree) { return []; }
    return getBranchPoints(tree);
}

export function getRedoPath(): string[] {
    const tree = undoTreeStore.value?.tree;
    if (!tree) { return []; }
    return getForwardPath(tree);
}
