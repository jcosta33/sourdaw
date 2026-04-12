import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree } from '../../../models/UndoTree';
import { undoTreeStore } from '../../../stores/undoTree';
import { createUndoEntry } from '../../commandQueries';
import { recordToTree } from '../recordToTree';

describe('recordToTree', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
    });

    it('should not update the tree when undo tree is disabled', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
        const entry = createUndoEntry('e', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const before = undoTreeStore.value?.tree;

        recordToTree(entry);

        expect(undoTreeStore.value?.tree).toEqual(before);
        expect(undoTreeStore.value?.tree.currentNodeId).toBeNull();
    });

    it('should not update when undoTreeStore value is null', () => {
        undoTreeStore.set(null);
        const entry = createUndoEntry('e', { type: 'toggleLoop' }, { type: 'toggleLoop' });

        recordToTree(entry);

        expect(undoTreeStore.value).toBeNull();
    });

    it('should push the entry into the tree when enabled', () => {
        const entry = createUndoEntry('e', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });

        recordToTree(entry);

        expect(undoTreeStore.value?.tree.currentNodeId).toBe('utn-1');
        expect(undoTreeStore.value?.tree.nodes['utn-1']?.entry).toBe(entry);
    });
});
