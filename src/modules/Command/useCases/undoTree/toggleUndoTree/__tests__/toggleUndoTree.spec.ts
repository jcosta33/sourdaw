import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree } from '../../../../models/UndoTree';
import { undoStore } from '../../../../stores/undoStore';
import { undoTreeStore } from '../../../../stores/undoTree';
import { createUndoEntry } from '../../../commandQueries';
import { toggleUndoTree } from '../toggleUndoTree';

describe('toggleUndoTree', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
        undoStore.set({ past: [], future: [] });
    });

    it('should flip enabled from false to true', () => {
        toggleUndoTree();
        expect(undoTreeStore.value?.enabled).toBe(true);
    });

    it('should flip enabled from true to false', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        toggleUndoTree();
        expect(undoTreeStore.value?.enabled).toBe(false);
    });

    it('should not throw when store value is null', () => {
        undoTreeStore.set(null);
        toggleUndoTree();
        expect(undoTreeStore.value).toBeNull();
    });

    it('retro-fills the tree from the existing past stack when enabled mid-session', () => {
        // Regression for audit #7/#27: recordToTree only mirrors while enabled, so a
        // session edited before enabling the tree previously yielded an empty tree on
        // enable. Toggling on must rebuild the tree from the entries already on `past`.
        const e1 = createUndoEntry('a', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const e2 = createUndoEntry('b', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        const e3 = createUndoEntry('c', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        undoStore.set({ past: [e1, e2, e3], future: [] });

        toggleUndoTree();

        const tree = undoTreeStore.value!.tree;
        // Three nodes, chained oldest → newest, current at the newest.
        expect(Object.keys(tree.nodes)).toHaveLength(3);
        expect(tree.currentNodeId).toBe('utn-3');
        expect(tree.nodes['utn-1']?.entry.id).toBe(e1.id);
        expect(tree.nodes['utn-2']?.entry.id).toBe(e2.id);
        expect(tree.nodes['utn-3']?.entry.id).toBe(e3.id);
        // Linear chain: each node parents the next.
        expect(tree.nodes['utn-1']?.children).toEqual(['utn-2']);
        expect(tree.nodes['utn-2']?.children).toEqual(['utn-3']);
        expect(tree.nodes['utn-2']?.parentId).toBe('utn-1');
        expect(tree.nodes['utn-3']?.parentId).toBe('utn-2');
    });

    it('rebuilds an empty tree when there is no history to retro-fill', () => {
        undoStore.set({ past: [], future: [] });
        toggleUndoTree();
        expect(undoTreeStore.value?.tree.nodes).toEqual({});
        expect(undoTreeStore.value?.tree.currentNodeId).toBeNull();
    });

    it('preserves the tree on disable (false transition)', () => {
        const e1 = createUndoEntry('a', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        undoStore.set({ past: [e1], future: [] });
        toggleUndoTree(); // enable + retro-fill
        const enabledTree = undoTreeStore.value!.tree;

        toggleUndoTree(); // disable

        expect(undoTreeStore.value?.enabled).toBe(false);
        expect(undoTreeStore.value?.tree).toBe(enabledTree);
    });
});
