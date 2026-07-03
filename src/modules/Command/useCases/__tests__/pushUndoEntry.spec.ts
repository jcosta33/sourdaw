import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pushUndoEntry } from '../pushUndoEntry';

const { commitUndoEntryMock } = vi.hoisted(() => ({
    commitUndoEntryMock: vi.fn(),
}));

vi.mock('../commitUndoEntry', () => ({
    commitUndoEntry: commitUndoEntryMock,
}));

describe('pushUndoEntry', () => {
    beforeEach(() => {
        commitUndoEntryMock.mockClear();
    });

    it('should commit a callback undo entry', () => {
        const undoFn = vi.fn();
        const redoFn = vi.fn();

        pushUndoEntry('My edit', undoFn, redoFn);

        expect(commitUndoEntryMock).toHaveBeenCalledOnce();
        const entry = commitUndoEntryMock.mock.calls[0][0];
        expect(entry.kind).toBe('callback');
        expect(entry.label).toBe('My edit');
        expect(entry.undo).toBe(undoFn);
        expect(entry.redo).toBe(redoFn);
        expect(entry.source).toBe('manual');
    });

    it('should attach groupId and groupLabel when provided', () => {
        pushUndoEntry('g', vi.fn(), vi.fn(), { groupId: 'gid-1', groupLabel: 'Batch' });

        const entry = commitUndoEntryMock.mock.calls[0][0];
        expect(entry.groupId).toBe('gid-1');
        expect(entry.groupLabel).toBe('Batch');
    });

    it('should pass source when provided', () => {
        pushUndoEntry('v', vi.fn(), vi.fn(), { source: 'ai' });

        expect(commitUndoEntryMock.mock.calls[0][0].source).toBe('ai');
    });
});
