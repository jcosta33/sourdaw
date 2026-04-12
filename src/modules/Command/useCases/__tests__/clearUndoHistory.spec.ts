import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { undoStore } from '../../stores/undoStore';
import { createUndoEntry } from '../commandQueries';
import { clearUndoHistory } from '../clearUndoHistory';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

describe('clearUndoHistory', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        undoStore.set({ past: [], future: [] });
    });

    afterEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('should clear past and future stacks', () => {
        const a = createUndoEntry('a', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const b = createUndoEntry('b', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        undoStore.set({ past: [a, b], future: [a] });

        clearUndoHistory();

        expect(undoStore.value).toEqual({ past: [], future: [] });
    });
});
