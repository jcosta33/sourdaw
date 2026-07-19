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

        await undoToIndex('entry:missing');

        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should return without stepping when target index matches the current past head', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two')],
            future: [actionEntry('three')],
        };

        await undoToIndex('entry:two');

        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should move backward by repeatedly calling undo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two'), actionEntry('three')],
            future: [],
        };
        mocks.undoUnderMutation.mockImplementation(async () => {
            const state = mocks.undoStoreValue.value!;
            const entry = state.past.at(-1)!;
            mocks.undoStoreValue.value = {
                past: state.past.slice(0, -1),
                future: [entry, ...state.future],
            };
        });

        await undoToIndex('entry:one');

        expect(mocks.undoUnderMutation).toHaveBeenCalledTimes(2);
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });

    it('should move forward by repeatedly calling redo', async () => {
        mocks.undoStoreValue.value = {
            past: [actionEntry('one')],
            future: [actionEntry('two'), actionEntry('three')],
        };
        mocks.redoUnderMutation.mockImplementation(async () => {
            const state = mocks.undoStoreValue.value!;
            const entry = state.future[0]!;
            mocks.undoStoreValue.value = {
                past: [...state.past, entry],
                future: state.future.slice(1),
            };
        });

        await undoToIndex('entry:three');

        expect(mocks.redoUnderMutation).toHaveBeenCalledTimes(2);
        expect(mocks.undoUnderMutation).not.toHaveBeenCalled();
    });

    it('targets a stable atomic history unit and advances from the live head', async () => {
        const first = actionEntry('one');
        const grouped_first = actionEntry('group-first');
        grouped_first.transactionGroupId = 'group';
        const grouped_second = actionEntry('group-second');
        grouped_second.transactionGroupId = 'group';
        const later = actionEntry('later');
        mocks.undoStoreValue.value = {
            past: [first, grouped_first, grouped_second, later],
            future: [],
        };
        mocks.undoUnderMutation.mockImplementation(async () => {
            mocks.undoStoreValue.value = {
                past: [first, grouped_first, grouped_second],
                future: [later],
            };
        });

        await undoToIndex('transaction:group');

        expect(mocks.undoUnderMutation).toHaveBeenCalledTimes(1);
        expect(mocks.redoUnderMutation).not.toHaveBeenCalled();
    });
});
