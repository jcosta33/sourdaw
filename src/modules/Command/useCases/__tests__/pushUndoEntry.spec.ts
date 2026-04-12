import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pushUndoEntry } from '../pushUndoEntry';

const { pushUndoMock } = vi.hoisted(() => ({
    pushUndoMock: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    pushUndo: pushUndoMock,
}));

describe('pushUndoEntry', () => {
    beforeEach(() => {
        pushUndoMock.mockClear();
    });

    it('should call pushUndo with a callback undo entry', () => {
        const undoFn = vi.fn();
        const redoFn = vi.fn();

        pushUndoEntry('My edit', undoFn, redoFn);

        expect(pushUndoMock).toHaveBeenCalledOnce();
        const entry = pushUndoMock.mock.calls[0][0];
        expect(entry.kind).toBe('callback');
        expect(entry.label).toBe('My edit');
        expect(entry.undo).toBe(undoFn);
        expect(entry.redo).toBe(redoFn);
        expect(entry.source).toBe('manual');
    });

    it('should attach groupId and groupLabel when provided', () => {
        pushUndoEntry('g', vi.fn(), vi.fn(), { groupId: 'gid-1', groupLabel: 'Batch' });

        const entry = pushUndoMock.mock.calls[0][0];
        expect(entry.groupId).toBe('gid-1');
        expect(entry.groupLabel).toBe('Batch');
    });

    it('should pass source when provided', () => {
        pushUndoEntry('v', vi.fn(), vi.fn(), { source: 'ai' });

        expect(pushUndoMock.mock.calls[0][0].source).toBe('ai');
    });
});
