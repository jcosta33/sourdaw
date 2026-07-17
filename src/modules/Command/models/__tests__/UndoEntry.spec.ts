import { describe, expect, it } from 'vitest';

import { type ActionUndoEntry, type CallbackUndoEntry, isActionEntry } from '../UndoEntry';

describe('isActionEntry', () => {
    it('should narrow action entries', () => {
        const actionEntry: ActionUndoEntry = {
            id: 'a',
            label: 'a',
            timestamp: 0,
            source: 'manual',
            kind: 'action',
            action: { type: 'toggleLoop' },
            inverseAction: null,
        };
        const callbackEntry: CallbackUndoEntry = {
            id: 'b',
            label: 'b',
            timestamp: 0,
            source: 'manual',
            kind: 'callback',
            undo: () => {},
            redo: () => {},
        };

        expect(isActionEntry(actionEntry)).toBe(true);
        expect(isActionEntry(callbackEntry)).toBe(false);
    });
});
