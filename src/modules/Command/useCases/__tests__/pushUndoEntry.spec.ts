import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CallbackUndoEntry } from '../../models/UndoEntry';
import { commitUndoEntry } from '../commitUndoEntry';
import { pushUndoEntry } from '../pushUndoEntry';

vi.mock('../commitUndoEntry', () => ({
    commitUndoEntry: vi.fn(),
}));

function getCommittedCallbackEntry(): CallbackUndoEntry {
    expect(commitUndoEntry).toHaveBeenCalledOnce();

    const call = vi.mocked(commitUndoEntry).mock.calls.at(0);
    if (call === undefined) {
        throw new Error('Expected commitUndoEntry to be called');
    }

    const [entry] = call;
    if (entry.kind !== 'callback') {
        throw new Error('Expected callback undo entry');
    }

    return entry;
}

describe('pushUndoEntry', () => {
    beforeEach(() => {
        vi.mocked(commitUndoEntry).mockClear();
    });

    it('should commit a callback undo entry', () => {
        const undoFn = vi.fn();
        const redoFn = vi.fn();

        pushUndoEntry('My edit', undoFn, redoFn);

        const entry = getCommittedCallbackEntry();
        expect(entry.kind).toBe('callback');
        expect(entry.label).toBe('My edit');
        expect(entry.undo).toBe(undoFn);
        expect(entry.redo).toBe(redoFn);
        expect(entry.source).toBe('manual');
    });

    it('should attach groupId and groupLabel when provided', () => {
        pushUndoEntry('g', vi.fn(), vi.fn(), { groupId: 'gid-1', groupLabel: 'Batch' });

        const entry = getCommittedCallbackEntry();
        expect(entry.groupId).toBe('gid-1');
        expect(entry.groupLabel).toBe('Batch');
    });

    it('should pass source when provided', () => {
        pushUndoEntry('v', vi.fn(), vi.fn(), { source: 'ai' });

        expect(getCommittedCallbackEntry().source).toBe('ai');
    });
});
