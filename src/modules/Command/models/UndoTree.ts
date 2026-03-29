import { type UndoEntry } from './UndoEntry';

/**
 * UndoTreeNode — a node in the branching undo tree.
 *
 * Each node holds an UndoEntry and may have multiple children (branches).
 * Only one child is "active" at a time (the one the user last followed).
 */
export type UndoTreeNode = {
    id: string;
    entry: UndoEntry;
    parentId: string | null;
    children: string[];
    /** Index into children[] indicating the active branch */
    activeBranch: number;
    /** Timestamp when this branch was created */
    createdAt: number;
    /** User-provided label for this branch (optional) */
    branchLabel?: string;
};

export type UndoTree = {
    /** Map of nodeId → node */
    nodes: Record<string, UndoTreeNode>;
    /** ID of the current node (where the user "is" in the tree) */
    currentNodeId: string | null;
    /** Root sentinel ID */
    rootId: string;
    /** Incrementing counter for node IDs */
    nextId: number;
};

const ROOT_ID = 'undo-root';

export function createEmptyTree(): UndoTree {
    return {
        nodes: {},
        currentNodeId: null,
        rootId: ROOT_ID,
        nextId: 1,
    };
}

/**
 * Push a new entry into the undo tree.
 *
 * If the current node already has children and we're at the end,
 * this creates a new branch (sibling) rather than destroying the future.
 */
export function pushToTree(tree: UndoTree, entry: UndoEntry): UndoTree {
    const nodeId = `utn-${tree.nextId}`;
    const parentId = tree.currentNodeId;

    const newNode: UndoTreeNode = {
        id: nodeId,
        entry,
        parentId,
        children: [],
        activeBranch: 0,
        createdAt: Date.now(),
    };

    const updatedNodes = { ...tree.nodes, [nodeId]: newNode };

    // Link parent → child
    if (parentId && updatedNodes[parentId]) {
        const parent = { ...updatedNodes[parentId] };
        parent.children = [...parent.children, nodeId];
        parent.activeBranch = parent.children.length - 1;
        updatedNodes[parentId] = parent;
    }

    return {
        ...tree,
        nodes: updatedNodes,
        currentNodeId: nodeId,
        nextId: tree.nextId + 1,
    };
}

/**
 * Label a branch at a given node.
 */
export function labelBranch(tree: UndoTree, nodeId: string, label: string): UndoTree {
    const node = tree.nodes[nodeId];
    if (!node) {
        return tree;
    }
    return {
        ...tree,
        nodes: {
            ...tree.nodes,
            [nodeId]: { ...node, branchLabel: label },
        },
    };
}
