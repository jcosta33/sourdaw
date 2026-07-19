import { describe, expect, it, vi } from 'vitest';

import { type CommitLegacyCommandUndo } from '#/utils/handlerContract';

import { createCallbackUndoEntry } from '../createCallbackUndoEntry';

function commitUndo(): void {}

function runLegacyMutation<Output>(
    mutation: (commitUndo: CommitLegacyCommandUndo) => Promise<Output> | Output
): Promise<Output> {
    return Promise.resolve(mutation(commitUndo));
}

describe('createCallbackUndoEntry', () => {
    it('should build a callback undo entry with undo and redo functions', () => {
        const undo = vi.fn();
        const redo = vi.fn();

        const entry = createCallbackUndoEntry({ label: 'cb', undo, redo, source: 'ai' });

        expect(entry.kind).toBe('callback');
        expect(entry.undo).toBe(undo);
        expect(entry.redo).toBe(redo);
        expect(entry.source).toBe('ai');

        entry.undo(runLegacyMutation);
        entry.redo(runLegacyMutation);

        expect(undo).toHaveBeenCalledTimes(1);
        expect(redo).toHaveBeenCalledTimes(1);
    });

    it('should default undo source to manual', () => {
        const entry = createCallbackUndoEntry({
            label: 'default',
            undo: vi.fn(),
            redo: vi.fn(),
        });

        expect(entry.source).toBe('manual');
    });
});
