import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory } from '../clearUndoHistory';

const { undoStoreSet, clearUndoStoreOwner } = vi.hoisted(() => ({
    undoStoreSet: vi.fn(),
    clearUndoStoreOwner: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: { set: undoStoreSet },
    clearUndoStoreOwner,
}));

describe('clearUndoHistory', () => {
    beforeEach(() => {
        undoStoreSet.mockClear();
        clearUndoStoreOwner.mockClear();
    });

    it('should clear undo and redo stacks', () => {
        clearUndoHistory();

        expect(clearUndoStoreOwner).toHaveBeenCalled();
        expect(undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });
});
