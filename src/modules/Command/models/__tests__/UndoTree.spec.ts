import { describe, it, expect } from 'vitest';

import { type ActionUndoEntry } from '../UndoEntry';
import { createEmptyTree, labelBranch, pushToTree, type UndoTree } from '../UndoTree';

function makeEntry(
    label: string,
    action: ActionUndoEntry['action'],
    inverseAction: ActionUndoEntry['inverseAction']
): ActionUndoEntry {
    return {
        id: label,
        kind: 'action',
        label,
        action,
        inverseAction,
        timestamp: 0,
        source: 'manual',
    };
}

describe('UndoTree', () => {
    describe('createEmptyTree', () => {
        it('should return an empty tree with root id and null current node', () => {
            const tree = createEmptyTree();
            expect(tree.nodes).toEqual({});
            expect(tree.currentNodeId).toBeNull();
            expect(tree.rootId).toBe('undo-root');
            expect(tree.nextId).toBe(1);
        });
    });

    describe('pushToTree', () => {
        it('should add a node and set it as current without a parent when tree was empty', () => {
            const tree = createEmptyTree();
            const entry = makeEntry('a', { type: 'togglePlayback' }, { type: 'stopPlayback' });
            const next = pushToTree(tree, entry);

            expect(next.nextId).toBe(2);
            expect(next.currentNodeId).toBe('utn-1');
            const node = next.nodes['utn-1'];
            expect(node).toBeDefined();
            expect(node?.entry).toBe(entry);
            expect(node?.parentId).toBeNull();
            expect(node?.children).toEqual([]);
        });

        it('should link a second node to the first as parent', () => {
            let tree: UndoTree = createEmptyTree();
            const e1 = makeEntry('one', { type: 'toggleLoop' }, { type: 'toggleLoop' });
            const e2 = makeEntry('two', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
            tree = pushToTree(tree, e1);
            tree = pushToTree(tree, e2);

            expect(tree.currentNodeId).toBe('utn-2');
            expect(tree.nodes['utn-1']?.children).toEqual(['utn-2']);
            expect(tree.nodes['utn-1']?.activeBranch).toBe(0);
            expect(tree.nodes['utn-2']?.parentId).toBe('utn-1');
        });
    });

    describe('labelBranch', () => {
        it('should set branchLabel on an existing node', () => {
            let tree = createEmptyTree();
            const entry = makeEntry('x', { type: 'setTempo', payload: { bpm: 120 } }, null);
            tree = pushToTree(tree, entry);
            const id = tree.currentNodeId!;
            tree = labelBranch(tree, id, 'My branch');

            expect(tree.nodes[id]?.branchLabel).toBe('My branch');
        });

        it('should return the same tree when node id is unknown', () => {
            const tree = createEmptyTree();
            const next = labelBranch(tree, 'missing', 'N');
            expect(next).toBe(tree);
        });
    });
});
