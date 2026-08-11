import { describe, it, expect, vi, beforeEach } from 'vitest';

import { REDO_NOT_APPLIED } from '../redoResult';
import { undoToIndex } from '../undoToIndex';

import type { ActionUndoEntry, CallbackUndoEntry } from '../../models/UndoEntry';
import type { UndoStoreState } from '../../stores/undoStore';

/**
 * Panel-path integration: the Undo History panel lists every past entry —
 * including inert ones — and passes the clicked row's raw `past` index to
 * undoToIndex. These tests run the real undo()/redo() against a writable
 * undoStore double, so the variable per-call consumption of undo() (dropping
 * inert entries while scanning for something undoable) is exercised for real.
 */

const mocks = vi.hoisted(() => {
    const undoStoreValue: { value: UndoStoreState | null } = {
        value: { past: [], future: [] },
    };
    return {
        undoStoreValue,
        executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
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

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../undoTree/undoTreeMoveTo', () => ({
    undoTreeMoveTo: mocks.undoTreeMoveTo,
}));

function undoableEntry(id: string): ActionUndoEntry {
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
    return { ...undoableEntry(id), inverseAction: null };
}

function notAppliedCallbackEntry(id: string): CallbackUndoEntry {
    return {
        kind: 'callback',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        undo: () => {},
        redo: () => REDO_NOT_APPLIED,
    };
}

describe('undoToIndex via the Undo History panel path', () => {
    beforeEach(() => {
        mocks.executeAppAction.mockReset();
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('keeps the clicked undoable entry when an inert entry sits between it and the head', async () => {
        const undoableA = undoableEntry('a');
        const inertB = inertEntry('b');
        const undoableC = undoableEntry('c');
        mocks.undoStoreValue.value = { past: [undoableA, inertB, undoableC], future: [] };

        // The panel passes the clicked row's raw past index; row 'a' is index 0.
        await undoToIndex(0);

        // Only 'c' is undone: the inert 'b' is dropped without reaching future
        // and the clicked 'a' stays at the head of past.
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value).toEqual({ past: [undoableA], future: [undoableC] });
        expect(mocks.undoTreeMoveTo).toHaveBeenLastCalledWith('a');
    });

    it('undoes only the entries above the clicked inert row', async () => {
        const undoableA = undoableEntry('a');
        const inertB = inertEntry('b');
        const undoableC = undoableEntry('c');
        mocks.undoStoreValue.value = { past: [undoableA, inertB, undoableC], future: [] };

        // Row 'b' is index 1: only 'c' sits above it.
        await undoToIndex(1);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value).toEqual({ past: [undoableA, inertB], future: [undoableC] });
    });

    it('forward sweep drops a not-applied callback entry and stops at the target row', async () => {
        const undoableA = undoableEntry('a');
        const stuck = notAppliedCallbackEntry('stuck');
        const undoableB = undoableEntry('b');
        mocks.undoStoreValue.value = { past: [undoableA], future: [stuck, undoableB] };

        // Target row index 1 = the state after re-applying 'b'; 'stuck' can never
        // re-apply, so the sweep must drop it instead of retrying it forever.
        await undoToIndex(1);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(undoableB.action, {
            skipUndo: true,
            skipMacroRecording: false,
            source: 'manual',
        });
        expect(mocks.undoStoreValue.value).toEqual({ past: [undoableA, undoableB], future: [] });
    });

    it('forward sweep stops when every remaining future entry is not-applied', async () => {
        const undoableA = undoableEntry('a');
        const stuck = notAppliedCallbackEntry('stuck');
        mocks.undoStoreValue.value = { past: [undoableA], future: [stuck] };

        // Target unreachable: the purge still makes progress and the sweep exits.
        await undoToIndex(1);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value).toEqual({ past: [undoableA], future: [] });
    });
});
