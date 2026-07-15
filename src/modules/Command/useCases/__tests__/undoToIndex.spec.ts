import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undoToIndex } from '../undoToIndex';

import type { ActionUndoEntry, UndoEntry } from '../../models/UndoEntry';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        } as import('../../stores/undoStore').UndoStoreState | null,
    },
    redo: vi.fn<() => Promise<void>>(),
    undo: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
    },
}));

vi.mock('../redo', () => ({
    redo: mocks.redo,
}));

vi.mock('../undo', () => ({
    undo: mocks.undo,
}));

function actionEntry(id: string): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
    };
}

describe('undoToIndex', () => {
    beforeEach(() => {
        mocks.redo.mockReset();
        mocks.undo.mockReset();
        mocks.redo.mockResolvedValue(undefined);
        mocks.undo.mockResolvedValue(undefined);
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('should return without stepping when the undo store is unavailable', async () => {
        mocks.undoStoreValue.value = null;

        await undoToIndex(0);

        expect(mocks.undo).not.toHaveBeenCalled();
        expect(mocks.redo).not.toHaveBeenCalled();
    });

    it('should return without stepping when target index matches the current past head', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two')],
            future: [actionEntry('three')],
        };

        await undoToIndex(1);

        expect(mocks.undo).not.toHaveBeenCalled();
        expect(mocks.redo).not.toHaveBeenCalled();
    });

    it('should move backward by repeatedly calling undo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two'), actionEntry('three')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undo).toHaveBeenCalledTimes(2);
        expect(mocks.redo).not.toHaveBeenCalled();
    });

    it('should move forward by repeatedly calling redo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one')],
            future: [actionEntry('two'), actionEntry('three')],
        };

        await undoToIndex(2);

        expect(mocks.redo).toHaveBeenCalledTimes(2);
        expect(mocks.undo).not.toHaveBeenCalled();
    });
});
