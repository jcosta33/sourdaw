import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
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
        notifyUser: vi.fn<(message: string, level?: string) => void>(),
    };
});

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

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

/** The document has moved on beneath this entry: replaying its inverse aborts. */
function conflictingEntry(id: string): ActionUndoEntry {
    return { ...undoableEntry(id), inverseAction: { type: 'stopPlayback' } };
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
        mocks.notifyUser.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    /** `past` is E0..E4 with only E4's inverse conflicting. */
    function stackWithConflictingHead(): void {
        mocks.undoStoreValue.value = {
            past: [
                undoableEntry('E0'),
                undoableEntry('E1'),
                undoableEntry('E2'),
                undoableEntry('E3'),
                conflictingEntry('E4'),
            ],
            future: [],
        };
        mocks.executeAppAction.mockImplementation(async (action) => {
            if (action.type === 'stopPlayback') {
                throw new AppActionConflictError('stopPlayback');
            }
        });
    }

    it('reverts nothing when the head conflicts and the clicked row is the one beneath it', async () => {
        stackWithConflictingHead();

        // Row 'E3' is index 3: the user asked for E4 gone and everything else kept.
        await undoToIndex(3);

        // E4's inverse writes nothing, so the row the user asked to remove is still
        // applied and the sweep cannot advance. Reaching past E4 for E3 would revert
        // precisely the row they clicked to keep.
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4']);
        expect(mocks.undoStoreValue.value.future).toEqual([]);
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Cannot undo "E4": project state has changed', 'warning');
    });

    it('reverts nothing beneath the conflict when the clicked row is several rows lower', async () => {
        stackWithConflictingHead();

        // Row 'E0' is index 0: three undoable entries sit between it and the conflict.
        await undoToIndex(0);

        // None of them may be reverted. The history below a blocked entry is only
        // reachable in the order the user recorded it.
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4']);
        expect(mocks.undoStoreValue.value.future).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Cannot undo "E4": project state has changed', 'warning');
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
        const [executedAction, options] = mocks.executeAppAction.mock.calls[0]!;
        expect(executedAction).toEqual(undoableB.action);
        expect(options).toMatchObject({ skipUndo: true, skipMacroRecording: true, source: 'manual' });
        expect(typeof options?.onCommitted).toBe('function');
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
