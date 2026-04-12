import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree, pushToTree } from '../../../../models/UndoTree';
import { undoTreeStore } from '../../../../stores/undoTree';
import { createUndoEntry } from '../../../commandQueries';
import { setNodeLabel } from '../setNodeLabel';

describe('setNodeLabel', () => {
    beforeEach(() => {
        let tree = createEmptyTree();
        tree = pushToTree(tree, createUndoEntry('x', { type: 'togglePlayback' }, { type: 'stopPlayback' }));
        undoTreeStore.set({ tree, enabled: true });
    });

    it('should apply labelBranch to the current tree node', () => {
        const id = undoTreeStore.value!.tree.currentNodeId!;
        setNodeLabel(id, 'Try A');

        expect(undoTreeStore.value?.tree.nodes[id]?.branchLabel).toBe('Try A');
    });

    it('should not mutate when store value is null', () => {
        undoTreeStore.set(null);
        setNodeLabel('utn-1', 'L');
        expect(undoTreeStore.value).toBeNull();
    });
});
