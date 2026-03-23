import { undoTreeStore } from '../../stores/undoTree';
import { getCurrentPath, getPathToNode } from '../../models/UndoTree';

/**
 * Navigate to a specific node in the undo tree.
 * Uses dynamic imports for undo/redo to avoid circular dependencies.
 */
export async function navigateToNode(targetNodeId: string): Promise<void> {
    const state = undoTreeStore.value;
    if (!state || !state.enabled) {
        return;
    }

    const tree = state.tree;
    const currentPath = getCurrentPath(tree);
    const targetPath = getPathToNode(tree, targetNodeId);

    let commonLength = 0;
    while (
        commonLength < currentPath.length &&
        commonLength < targetPath.length &&
        currentPath[commonLength] === targetPath[commonLength]
    ) {
        commonLength++;
    }

    const stepsBack = currentPath.length - commonLength;
    const { undo } = await import('../undoRedo');
    for (let i = 0; i < stepsBack; i++) {
        await undo();
    }

    const { redo } = await import('../undoRedo');
    const stepsForward = targetPath.length - commonLength;
    for (let i = 0; i < stepsForward; i++) {
        const nodeId = targetPath[commonLength + i]!;
        const node = tree.nodes[nodeId];
        if (node?.parentId) {
            const parent = tree.nodes[node.parentId];
            if (parent) {
                const branchIdx = parent.children.indexOf(nodeId);
                if (branchIdx >= 0 && branchIdx !== parent.activeBranch) {
                    const updatedTree = {
                        ...tree,
                        nodes: {
                            ...tree.nodes,
                            [node.parentId]: { ...parent, activeBranch: branchIdx },
                        },
                    };
                    undoTreeStore.set({ ...state, tree: updatedTree });
                }
            }
        }
        await redo();
    }

    undoTreeStore.set({
        ...undoTreeStore.value!,
        tree: {
            ...undoTreeStore.value!.tree,
            currentNodeId: targetNodeId,
        },
    });
}
