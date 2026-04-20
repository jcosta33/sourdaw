import { describe, it, expect, beforeEach } from 'vitest';

import { type UndoTreeNode, createEmptyTree, type UndoTree } from '../../../../models/UndoTree';
import { undoTreeStore } from '../../../../stores/undoTree';
import { createUndoEntry } from '../../../commandQueries';
import { switchBranch } from '../switchBranch';

describe('switchBranch', () => {
    beforeEach(() => {
        const e0 = createUndoEntry('root', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const e1 = createUndoEntry('a', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        const e2 = createUndoEntry('b', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });

        const fork: UndoTreeNode = {
            id: 'fork',
            entry: e0,
            parentId: null,
            children: ['child0', 'child1'],
            activeBranch: 0,
            createdAt: 0,
        };
        const child0: UndoTreeNode = {
            id: 'child0',
            entry: e1,
            parentId: 'fork',
            children: [],
            activeBranch: 0,
            createdAt: 0,
        };
        const child1: UndoTreeNode = {
            id: 'child1',
            entry: e2,
            parentId: 'fork',
            children: [],
            activeBranch: 0,
            createdAt: 0,
        };

        const tree: UndoTree = {
            ...createEmptyTree(),
            nodes: { fork, child0, child1 },
            currentNodeId: 'child0',
            nextId: 3,
        };

        undoTreeStore.set({ tree, enabled: true });
    });

    it('should set activeBranch on the fork node', () => {
        switchBranch('fork', 1);
        expect(undoTreeStore.value?.tree.nodes.fork?.activeBranch).toBe(1);
    });

    it('should not mutate when branch index is out of range', () => {
        const before = undoTreeStore.value;
        switchBranch('fork', 9);
        expect(undoTreeStore.value?.tree.nodes.fork?.activeBranch).toBe(0);
        expect(undoTreeStore.value).toBe(before);
    });

    it('should not mutate when fork node id is unknown', () => {
        const before = undoTreeStore.value;
        switchBranch('missing', 0);
        expect(undoTreeStore.value).toBe(before);
    });

    it('should not mutate when store value is null', () => {
        undoTreeStore.set(null);
        switchBranch('fork', 1);
        expect(undoTreeStore.value).toBeNull();
    });
});
