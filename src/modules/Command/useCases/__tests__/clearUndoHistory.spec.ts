import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { createEmptyTree } from '../../models/UndoTree';
import { undoTreeStore } from '../../stores/undoTree';
import { clearUndoHistory } from '../clearUndoHistory';
import { recordToTree } from '../undoTree/recordToTree';

const { undoStoreSet, clearUndoStoreOwner } = vi.hoisted(() => ({
    undoStoreSet: vi.fn(),
    clearUndoStoreOwner: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: { set: undoStoreSet },
    clearUndoStoreOwner,
}));

function undoableEntry(id: string): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
    };
}

describe('clearUndoHistory', () => {
    beforeEach(() => {
        undoStoreSet.mockClear();
        clearUndoStoreOwner.mockClear();
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
    });

    it('should clear undo and redo stacks', () => {
        clearUndoHistory();

        expect(clearUndoStoreOwner).toHaveBeenCalled();
        expect(clearUndoStoreOwner.mock.invocationCallOrder[0]).toBeLessThan(undoStoreSet.mock.invocationCallOrder[0]!);
        expect(undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });

    it('resets the tree mirror to the empty root a fresh session holds', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        recordToTree(undoableEntry('stale-1'));
        recordToTree(undoableEntry('stale-2'));
        expect(undoTreeStore.value?.tree.currentNodeId).not.toBeNull();

        clearUndoHistory();

        expect(undoTreeStore.value?.tree).toEqual(createEmptyTree());
        expect(undoTreeStore.value?.enabled).toBe(true);
    });
});
