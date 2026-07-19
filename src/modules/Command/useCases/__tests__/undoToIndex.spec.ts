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
    redoUnderMutation: vi.fn<() => Promise<void>>(),
    undoUnderMutation: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
    },
}));

vi.mock('../redoUnderMutation', () => ({
    redoUnderMutation: mocks.redoUnderMutation,
}));

vi.mock('../undoUnderMutation', () => ({
    undoUnderMutation: mocks.undoUnderMutation,
}));

vi.mock('../undoRedo', () => ({
    runUndoRedoExclusive: (operation: () => Promise<void>) => operation(),
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
        mocks.redoUnderMutation.mockReset();
        mocks.undoUnderMutation.mockReset();
        mocks.redoUnderMutation.mockResolvedValue(undefined);
        mocks.undoUnderMutation.mockResolvedValue(undefined);
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('should return without stepping when the undo store is unavailable', async () => {
        mocks.undoStoreValue.value = null;

        await undoToIndex(0);

        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should return without stepping when target index matches the current past head', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two')],
            future: [actionEntry('three')],
        };

        await undoToIndex(1);

        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should move backward by repeatedly calling undo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two'), actionEntry('three')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undoUnderMutation).toHaveBeenCalledTimes(2);
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should move forward by repeatedly calling redo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one')],
            future: [actionEntry('two'), actionEntry('three')],
        };

        await undoToIndex(2);

        expect(mocks.redoUnderMutation).toHaveBeenCalledTimes(2);
        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
    });
});
