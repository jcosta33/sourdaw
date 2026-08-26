import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undoToIndex } from '../undoToIndex';

import type { ActionUndoEntry } from '../../models/UndoEntry';
import type { UndoStoreState } from '../../stores/undoStore';
import type { UndoResult } from '../undo';

const mocks = vi.hoisted(() => {
    const undoStoreValue: { value: UndoStoreState | null } = {
        value: { past: [], future: [] },
    };
    return {
        undoStoreValue,
        redo: vi.fn<() => Promise<void>>(),
        undo: vi.fn<() => Promise<UndoResult>>(),
        undoTreeMoveTo: vi.fn<(currentEntryId: string | null) => void>(),
    };
});

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: (next: UndoStoreState) => {
            mocks.undoStoreValue.value = next;
        },
    },
}));

vi.mock('../redo', () => ({
    redo: mocks.redo,
}));

vi.mock('../undo', () => ({
    undo: mocks.undo,
}));

vi.mock('../undoTree/undoTreeMoveTo', () => ({
    undoTreeMoveTo: mocks.undoTreeMoveTo,
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

function inertEntry(id: string): ActionUndoEntry {
    return { ...actionEntry(id), inverseAction: null };
}

/** Simulates the real undo(): pops one undoable head entry into future. */
function mockUndoConsumingHead(): void {
    mocks.undo.mockImplementation(() => {
        const state = mocks.undoStoreValue.value;
        if (!state || state.past.length === 0) {
            return Promise.resolve({ headConsumed: false });
        }
        const head = state.past[state.past.length - 1]!;
        mocks.undoStoreValue.value = {
            past: state.past.slice(0, -1),
            future: [head, ...state.future],
        };
        return Promise.resolve({ headConsumed: true });
    });
}

/** Simulates the real redo(): shifts one future entry into past. */
function mockRedoConsumingHead(): void {
    mocks.redo.mockImplementation(() => {
        const state = mocks.undoStoreValue.value;
        if (!state || state.future.length === 0) {
            return Promise.resolve();
        }
        const head = state.future[0]!;
        mocks.undoStoreValue.value = {
            past: [...state.past, head],
            future: state.future.slice(1),
        };
        return Promise.resolve();
    });
}

describe('undoToIndex', () => {
    beforeEach(() => {
        mocks.redo.mockReset();
        mocks.undo.mockReset();
        mocks.undoTreeMoveTo.mockReset();
        mocks.redo.mockResolvedValue(undefined);
        mocks.undo.mockResolvedValue({ headConsumed: false });
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
        mockUndoConsumingHead();
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two'), actionEntry('three')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undo).toHaveBeenCalledTimes(2);
        expect(mocks.redo).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['one']);
    });

    it('should move forward by repeatedly calling redo', async () => {
        mockRedoConsumingHead();
        mocks.undoStoreValue.value = {
            past: [actionEntry('one')],
            future: [actionEntry('two'), actionEntry('three')],
        };

        await undoToIndex(2);

        expect(mocks.redo).toHaveBeenCalledTimes(2);
        expect(mocks.undo).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['one', 'two', 'three']);
    });

    it('should stop the forward sweep when redo makes no progress', async () => {
        // A redo() that neither applies nor drops anything (store untouched) must
        // not be retried for the full fixed step count.
        mocks.undoStoreValue.value = {
            past: [actionEntry('one')],
            future: [actionEntry('two'), actionEntry('three')],
        };

        await undoToIndex(2);

        expect(mocks.redo).toHaveBeenCalledTimes(1);
        expect(mocks.undo).not.toHaveBeenCalled();
    });

    it('should drop an inert entry above the target without undoing the target row', async () => {
        // Review scenario: past=[A(undoable), B(inert), C(undoable)], user clicks
        // row A (targetIndex 0). A fixed call count — or a loop that lets undo()
        // sweep the inert B — undoes A, the entry the user chose to keep.
        mockUndoConsumingHead();
        mocks.undoStoreValue.value = {
            past: [actionEntry('A'), inertEntry('B'), actionEntry('C')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undo).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['A']);
        // The dropped inert B never reaches future: nothing was undone for it.
        expect(mocks.undoStoreValue.value.future.map((entry) => entry.id)).toEqual(['C']);
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('A');
    });

    it('should stop exactly at the target when several inert entries sit above it', async () => {
        mockUndoConsumingHead();
        mocks.undoStoreValue.value = {
            past: [actionEntry('A'), inertEntry('B'), inertEntry('C'), actionEntry('D')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undo).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['A']);
    });

    it('should stop when undo reports the head entry unconsumed instead of looping forever', async () => {
        // `headConsumed: false` is undo()'s statement that the entry this sweep is
        // walking down from is still applied — here because its inverse conflicted
        // and wrote nothing. The sweep reads that result rather than counting
        // entries, because one undo() also drops any inert entries it passes and a
        // shortened `past` says nothing about whether the head was undone.
        mocks.undoStoreValue.value = {
            past: [actionEntry('one'), actionEntry('two')],
            future: [],
        };

        await undoToIndex(0);

        expect(mocks.undo).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value.past).toHaveLength(2);
    });
});
