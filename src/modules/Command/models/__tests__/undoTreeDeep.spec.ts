import { describe, it, expect } from 'vitest';

import { type UndoEntry } from '../UndoEntry';
import { createEmptyTree, labelBranch, pushToTree, type UndoTree } from '../UndoTree';

function entry(id: string): UndoEntry {
    return {
        id,
        label: id,
        timestamp: 1000,
        source: 'manual',
        kind: 'callback',
        undo: () => undefined,
        redo: () => undefined,
    };
}

describe('createEmptyTree', () => {
    it('returns a tree with no nodes and a null current pointer', () => {
        const tree = createEmptyTree();
        expect(tree.nodes).toEqual({});
        expect(tree.currentNodeId).toBeNull();
        expect(tree.nextId).toBe(1);
        expect(tree.rootId).toBe('undo-root');
    });
});

describe('pushToTree', () => {
    it('adds a first node with the root as parent and advances the current pointer', () => {
        const tree = pushToTree(createEmptyTree(), entry('a'));
        expect(Object.keys(tree.nodes)).toEqual(['utn-1']);
        const node = tree.nodes['utn-1']!;
        expect(node.entry.id).toBe('a');
        expect(node.parentId).toBeNull();
        expect(node.children).toEqual([]);
        expect(tree.currentNodeId).toBe('utn-1');
        expect(tree.nextId).toBe(2);
    });

    it('links a second node to the first as a child and sets activeBranch', () => {
        let tree = pushToTree(createEmptyTree(), entry('a'));
        tree = pushToTree(tree, entry('b'));
        expect(tree.currentNodeId).toBe('utn-2');
        const parent = tree.nodes['utn-1']!;
        expect(parent.children).toEqual(['utn-2']);
        expect(parent.activeBranch).toBe(0);
        expect(tree.nodes['utn-2']!.parentId).toBe('utn-1');
        expect(tree.nextId).toBe(3);
    });

    it('does not mutate the original tree (immutability)', () => {
        const empty = createEmptyTree();
        const next = pushToTree(empty, entry('a'));
        // Original stays empty.
        expect(Object.keys(empty.nodes)).toHaveLength(0);
        expect(empty.currentNodeId).toBeNull();
        expect(Object.keys(next.nodes)).toHaveLength(1);
    });

    it('creates a branch (sibling) when pushing after moving back to a node with existing children', () => {
        // Build a linear chain: root → a → b
        let tree = pushToTree(createEmptyTree(), entry('a'));
        tree = pushToTree(tree, entry('b'));
        // Rewind current to 'a' (which already has child 'utn-2'), then push 'c'.
        const rewound: UndoTree = { ...tree, currentNodeId: 'utn-1' };
        const branched = pushToTree(rewound, entry('c'));

        // 'a' now has two children: the original 'b' and the new 'c'.
        const parent = branched.nodes['utn-1']!;
        expect(parent.children).toEqual(['utn-2', 'utn-3']);
        // activeBranch points to the newly added child (index 1).
        expect(parent.activeBranch).toBe(1);
        expect(branched.currentNodeId).toBe('utn-3');
        expect(branched.nodes['utn-3']!.entry.id).toBe('c');
    });

    it('preserves existing children when branching', () => {
        let tree = pushToTree(createEmptyTree(), entry('a'));
        tree = pushToTree(tree, entry('b'));
        const rewound: UndoTree = { ...tree, currentNodeId: 'utn-1' };
        const branched = pushToTree(rewound, entry('c'));
        // The original child 'b' is untouched.
        expect(branched.nodes['utn-2']!.entry.id).toBe('b');
        expect(branched.nodes['utn-2']!.children).toEqual([]);
    });

    it('assigns monotonically increasing node ids', () => {
        let tree = createEmptyTree();
        tree = pushToTree(tree, entry('a'));
        tree = pushToTree(tree, entry('b'));
        tree = pushToTree(tree, entry('c'));
        expect(Object.keys(tree.nodes)).toEqual(['utn-1', 'utn-2', 'utn-3']);
        expect(tree.nextId).toBe(4);
    });
});

describe('labelBranch', () => {
    it('sets a branch label on the target node', () => {
        let tree = pushToTree(createEmptyTree(), entry('a'));
        tree = labelBranch(tree, 'utn-1', 'experiment-1');
        expect(tree.nodes['utn-1']!.branchLabel).toBe('experiment-1');
    });

    it('overwrites an existing label', () => {
        let tree = pushToTree(createEmptyTree(), entry('a'));
        tree = labelBranch(tree, 'utn-1', 'first');
        tree = labelBranch(tree, 'utn-1', 'second');
        expect(tree.nodes['utn-1']!.branchLabel).toBe('second');
    });

    it('returns the tree unchanged for an unknown node id', () => {
        const tree = pushToTree(createEmptyTree(), entry('a'));
        const labeled = labelBranch(tree, 'nonexistent', 'x');
        // Same reference returned (no mutation).
        expect(labeled).toBe(tree);
    });

    it('does not mutate the original tree', () => {
        const tree = pushToTree(createEmptyTree(), entry('a'));
        const labeled = labelBranch(tree, 'utn-1', 'label');
        expect(tree.nodes['utn-1']!.branchLabel).toBeUndefined();
        expect(labeled.nodes['utn-1']!.branchLabel).toBe('label');
    });
});
