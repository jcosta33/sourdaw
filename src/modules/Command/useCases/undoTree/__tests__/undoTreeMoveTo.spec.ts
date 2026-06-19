import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree, pushToTree, type UndoTree } from '../../../models/UndoTree';
import { undoTreeStore } from '../../../stores/undoTree';
import { createUndoEntry } from '../../commandQueries';
import { undoTreeMoveTo } from '../undoTreeMoveTo';

function buildLinearTree(): { tree: UndoTree; ids: string[] } {
    const e1 = createUndoEntry('a', { type: 'togglePlayback' }, { type: 'stopPlayback' });
    const e2 = createUndoEntry('b', { type: 'toggleLoop' }, { type: 'toggleLoop' });
    const e3 = createUndoEntry('c', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
    let tree = createEmptyTree();
    tree = pushToTree(tree, e1);
    tree = pushToTree(tree, e2);
    tree = pushToTree(tree, e3);
    return { tree, ids: [e1.id, e2.id, e3.id] };
}

describe('undoTreeMoveTo', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
    });

    it('moves currentNodeId to the node whose entry matches the given entry id', () => {
        const { tree, ids } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: true });
        // tree head is utn-3; simulate an undo step back to the second entry.
        undoTreeMoveTo(ids[1]!);

        expect(undoTreeStore.value?.tree.currentNodeId).toBe('utn-2');
    });

    it('moves currentNodeId to null when the past stack is empty (back at root)', () => {
        const { tree } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: true });

        undoTreeMoveTo(null);

        expect(undoTreeStore.value?.tree.currentNodeId).toBeNull();
    });

    it('does not move when the entry id has no node yet (un-retro-filled)', () => {
        const { tree } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: true });
        const before = undoTreeStore.value;

        undoTreeMoveTo('entry-with-no-node');

        // Strict identity: a no-op must not even re-set the store.
        expect(undoTreeStore.value).toBe(before);
    });

    it('does not move when the undo tree is disabled', () => {
        const { tree, ids } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: false });
        const before = undoTreeStore.value;

        undoTreeMoveTo(ids[0]!);

        expect(undoTreeStore.value).toBe(before);
        expect(undoTreeStore.value?.tree.currentNodeId).toBe('utn-3');
    });

    it('does not re-set the store when already at the target node', () => {
        const { tree, ids } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: true });
        const before = undoTreeStore.value;

        // utn-3 (the head) holds the third entry; we are already there.
        undoTreeMoveTo(ids[2]!);

        expect(undoTreeStore.value).toBe(before);
    });

    it('does nothing when store value is null', () => {
        undoTreeStore.set(null);
        undoTreeMoveTo('anything');
        expect(undoTreeStore.value).toBeNull();
    });

    it('mirrors the user position so a later pushToTree parents off the moved node, not the last-pushed one', () => {
        // The core audit #46 scenario: undo back one step, then a new edit must branch
        // off the moved position rather than collapse onto the last-pushed node.
        const { tree, ids } = buildLinearTree();
        undoTreeStore.set({ tree, enabled: true });

        undoTreeMoveTo(ids[1]!); // move back to utn-2

        const moved = undoTreeStore.value!.tree;
        const newEntry = createUndoEntry('d', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        const afterPush = pushToTree(moved, newEntry);

        // The new node parents off utn-2 (the real position), forking the tree.
        const newNodeId = afterPush.currentNodeId!;
        expect(afterPush.nodes[newNodeId]?.parentId).toBe('utn-2');
        expect(afterPush.nodes['utn-2']?.children).toContain(newNodeId);
    });
});
