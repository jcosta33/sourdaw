import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { type UndoStoreState } from '../../stores/undoStore';
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
        const action: AppAction = { type: 'addTrack', payload: { name: 'Test', kind: 'midi' } };
        const inverseAction: AppAction = { type: 'removeTrack', payload: { trackId: 't1' } };
        const entry: ActionUndoEntry = {
            id: 'undo-1',
            kind: 'action',
            label: 'Move clip',
            action,
            inverseAction,
            timestamp: 1,
            source: 'manual',
        };
        const captured: UndoStoreState = { past: [entry], future: [] };

        restoreUndoHistory(captured);

        expect(undoStoreSet).toHaveBeenCalledWith(captured);
    });
});
