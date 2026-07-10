import { describe, it, expect, vi, beforeEach } from 'vitest';

import { redo } from '../redo';

import type { ActionUndoEntry, CallbackUndoEntry } from '../commandQueries';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as import('../commandQueries').UndoEntry[],
            future: [] as import('../commandQueries').UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
    undoTreeMoveTo: vi.fn<(currentEntryId: string | null) => void>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: mocks.undoStoreSet,
    },
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../undoTree/undoTreeMoveTo', () => ({
    undoTreeMoveTo: mocks.undoTreeMoveTo,
}));

function actionEntry(overrides: Partial<ActionUndoEntry> = {}): ActionUndoEntry {
    return {
        kind: 'action',
        id: 'e1',
        label: 'Test',
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
        ...overrides,
    };
}

function callbackEntry(overrides: Partial<CallbackUndoEntry> = {}): CallbackUndoEntry {
    return {
        kind: 'callback',
        id: 'callback-1',
        label: 'Callback',
        timestamp: 0,
        source: 'manual',
        undo: vi.fn(),
        redo: vi.fn(),
        ...overrides,
    };
}

describe('redo', () => {
    beforeEach(() => {
        mocks.undoStoreSet.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('should execute the action and move the entry back to past', async () => {
        const entry = actionEntry();
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'togglePlayback' });
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [entry],
            future: [],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('e1');
    });

    it('should run callback redo entries without action replay', async () => {
        const redoFn = vi.fn();
        const entry = callbackEntry({ redo: redoFn });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(redoFn).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [entry],
            future: [],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('callback-1');
    });

    it('should not write when future is empty', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry()], future: [] };

        await redo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });
});
