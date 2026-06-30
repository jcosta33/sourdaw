import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory } from '../clearUndoHistory';

const { undoStoreSet } = vi.hoisted(() => ({
    undoStoreSet: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: { set: undoStoreSet },
}));

describe('clearUndoHistory', () => {
    beforeEach(() => {
        undoStoreSet.mockClear();
    });

    it('should clear undo and redo stacks', () => {
        clearUndoHistory();

        expect(undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });
});
