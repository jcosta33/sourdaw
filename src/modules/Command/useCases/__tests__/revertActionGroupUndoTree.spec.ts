import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyTree } from '../../models/UndoTree';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { commitUndoEntry } from '../commitUndoEntry';
import { createUndoEntry } from '../createUndoEntry';
import { revertActionGroup } from '../revertActionGroup';
import { recordToTree } from '../undoTree/recordToTree';

const { executeAppActionImpl } = vi.hoisted(() => ({
    executeAppActionImpl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../executeAppActionImpl', () => ({ executeAppActionImpl }));

describe('revertActionGroup undo tree integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        undoStore.set({ past: [], future: [] });
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
    });

    it('reparents G1 -> G2 -> U after removing G before the next edit', async () => {
        const groupFirst = createUndoEntry(
            'G1',
            { type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.5 } },
            {
                type: 'restoreAdjustmentLayerMutation',
                payload: {
                    adjustmentMutationId: 'mutation-1',
                    operation: {
                        kind: 'restore-mix',
                        layerId: 'layer-1',
                        previous: 0.25,
                        expected: 0.5,
                    },
                    staleTransitions: [],
                },
            }
        );
        groupFirst.groupId = 'G';
        const groupSecond = createUndoEntry(
            'G2',
            { type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } },
            {
                type: 'restoreAdjustmentLayerMutation',
                payload: {
                    adjustmentMutationId: 'mutation-2',
                    operation: {
                        kind: 'restore-mix',
                        layerId: 'layer-1',
                        previous: 0.5,
                        expected: 0.75,
                    },
                    staleTransitions: [],
                },
            }
        );
        groupSecond.groupId = 'G';
        const unrelated = createUndoEntry('U', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        undoStore.set({ past: [groupFirst, groupSecond, unrelated], future: [] });
        recordToTree(groupFirst);
        recordToTree(groupSecond);
        recordToTree(unrelated);

        await expect(revertActionGroup('G')).resolves.toBe(true);
        const nextEdit = createUndoEntry('next edit', { type: 'stopPlayback' }, { type: 'togglePlayback' });
        commitUndoEntry(nextEdit);

        const tree = undoTreeStore.value?.tree;
        function nodeByEntryId(entryId: string) {
            return Object.values(tree?.nodes ?? {}).find((node) => node.entry.id === entryId);
        }
        const unrelatedNode = nodeByEntryId(unrelated.id);
        const groupFirstNode = nodeByEntryId(groupFirst.id);
        const groupSecondNode = nodeByEntryId(groupSecond.id);
        const nextEditNode = nodeByEntryId(nextEdit.id);

        expect(unrelatedNode?.parentId).toBeNull();
        expect(groupFirstNode?.parentId).toBe(unrelatedNode?.id);
        expect(groupSecondNode?.parentId).toBe(groupFirstNode?.id);
        expect(nextEditNode?.parentId).toBe(unrelatedNode?.id);
        expect(unrelatedNode?.children).toEqual([groupFirstNode?.id, nextEditNode?.id]);
        expect(tree?.currentNodeId).toBe(nextEditNode?.id);
    });
});
