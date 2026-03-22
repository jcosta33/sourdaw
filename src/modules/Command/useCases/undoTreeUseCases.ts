/**
 * Branching Undo Tree Use Cases.
 *
 * Maintains a tree-structured undo history where undoing and performing
 * a new action creates a branch rather than destroying the future.
 * Users can switch between branches to explore alternatives.
 */


import { type UndoEntry } from '../models/UndoEntry';
import {
    type UndoTree,
    createEmptyTree,
    pushToTree,
    getCurrentPath,
    getForwardPath,
    getPathToNode,
    countBranches,
    getBranchPoints,
    labelBranch,
} from '../models/UndoTree';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

// ── Tree store ────────────────────────────────────────────────────────

export type UndoTreeStoreState = {
    tree: UndoTree;
    enabled: boolean;
};

export const undoTreeStore = new Store<UndoTreeStoreState>(logger, {
    initialData: {
        tree: createEmptyTree(),
        enabled: false,
    },
});

// ── Toggle ────────────────────────────────────────────────────────────

export function toggleUndoTree(): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    undoTreeStore.set({ ...state, enabled: !state.enabled });
}

export function isUndoTreeEnabled(): boolean {
    return undoTreeStore.value?.enabled ?? false;
}

// ── Record ────────────────────────────────────────────────────────────

/**
 * Called from undoStore subscriber to mirror entries into the tree.
 * Only records when the tree is enabled.
 */
export function recordToTree(entry: UndoEntry): void {
    const state = undoTreeStore.value;
    if (!state || !state.enabled) {
        return;
    }
    undoTreeStore.set({
        ...state,
        tree: pushToTree(state.tree, entry),
    });
}

// ── Navigation ────────────────────────────────────────────────────────

/**
 * Navigate to a specific node in the undo tree.
 * This will: 1) undo back to the common ancestor, 2) redo down the target path.
 */
export async function navigateToNode(targetNodeId: string): Promise<void> {
    const state = undoTreeStore.value;
    if (!state || !state.enabled) {
        return;
    }

    const tree = state.tree;
    const currentPath = getCurrentPath(tree);
    const targetPath = getPathToNode(tree, targetNodeId);

    // Find common ancestor
    let commonLength = 0;
    while (
        commonLength < currentPath.length &&
        commonLength < targetPath.length &&
        currentPath[commonLength] === targetPath[commonLength]
    ) {
        commonLength++;
    }

    // Undo back to common ancestor
    const stepsBack = currentPath.length - commonLength;
    const { undo } = await import('./undoRedo');
    for (let i = 0; i < stepsBack; i++) {
        await undo();
    }

    // Redo forward along the target path
    const { redo } = await import('./undoRedo');
    const stepsForward = targetPath.length - commonLength;
    for (let i = 0; i < stepsForward; i++) {
        // Set active branch at each fork along the way
        const nodeId = targetPath[commonLength + i]!;
        const node = tree.nodes[nodeId];
        if (node?.parentId) {
            const parent = tree.nodes[node.parentId];
            if (parent) {
                const branchIdx = parent.children.indexOf(nodeId);
                if (branchIdx >= 0 && branchIdx !== parent.activeBranch) {
                    // Update active branch on parent
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

    // Update current node pointer
    undoTreeStore.set({
        ...undoTreeStore.value!,
        tree: {
            ...undoTreeStore.value!.tree,
            currentNodeId: targetNodeId,
        },
    });
}

/**
 * Switch to a different branch at a fork point.
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

/**
 * Label a branch for easy identification.
 */
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

// ── Queries ───────────────────────────────────────────────────────────

export function getUndoTree(): UndoTree | null {
    return undoTreeStore.value?.tree ?? null;
}

export function getTreeStats(): { totalNodes: number; branches: number; depth: number } {
    const tree = undoTreeStore.value?.tree;
    if (!tree) {
        return { totalNodes: 0, branches: 0, depth: 0 };
    }
    return {
        totalNodes: Object.keys(tree.nodes).length,
        branches: countBranches(tree),
        depth: getCurrentPath(tree).length,
    };
}

export function getTreeBranchPoints() {
    const tree = undoTreeStore.value?.tree;
    if (!tree) {
        return [];
    }
    return getBranchPoints(tree);
}

export function getRedoPath(): string[] {
    const tree = undoTreeStore.value?.tree;
    if (!tree) {
        return [];
    }
    return getForwardPath(tree);
}
