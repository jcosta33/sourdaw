import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreUndoHistory } from '../restoreUndoHistory';

const { undoStoreSet } = vi.hoisted(() => ({
    undoStoreSet: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: { set: undoStoreSet },
}));

describe('restoreUndoHistory', () => {
    beforeEach(() => {
        undoStoreSet.mockClear();
    });

    it('sets the undo store back to the captured state, action data included', () => {
        const entry = {
            id: 'undo-1',
            kind: 'action',
            label: 'Move clip',
            action: { type: 'x' },
            inverseAction: { type: 'y' },
            timestamp: 1,
            source: 'manual',
        };
        const captured = { past: [entry], future: [] };

        restoreUndoHistory(captured);

        expect(undoStoreSet).toHaveBeenCalledWith(captured);
    });
});
