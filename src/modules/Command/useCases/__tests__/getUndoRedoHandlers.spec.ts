import { describe, it, expect } from 'vitest';

import { handleRedo } from '../../handlers/undoRedo/handleRedo';
import { handleUndo } from '../../handlers/undoRedo/handleUndo';
import { getUndoRedoHandlers } from '../getUndoRedoHandlers';

describe('getUndoRedoHandlers', () => {
    it('merges the undo and redo handlers into a single map keyed by action type', () => {
        const handlers = getUndoRedoHandlers();

        expect(handlers).toEqual({ undo: handleUndo, redo: handleRedo });
        expect(Object.keys(handlers)).toEqual(['undo', 'redo']);
    });
});
