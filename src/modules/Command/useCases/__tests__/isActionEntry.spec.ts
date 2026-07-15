import { describe, expect, it, vi } from 'vitest';

import { createCallbackUndoEntry } from '../createCallbackUndoEntry';
import { createUndoEntry } from '../createUndoEntry';
import { isActionEntry } from '../isActionEntry';

describe('isActionEntry', () => {
    it('should narrow action entries', () => {
        const actionEntry = createUndoEntry('a', { type: 'toggleLoop' }, null);
        const callbackEntry = createCallbackUndoEntry({
            label: 'b',
            undo: vi.fn(),
            redo: vi.fn(),
        });

        expect(isActionEntry(actionEntry)).toBe(true);
        expect(isActionEntry(callbackEntry)).toBe(false);
    });
});
