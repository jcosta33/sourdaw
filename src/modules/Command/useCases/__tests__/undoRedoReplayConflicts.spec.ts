import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { redo } from '../redo';
import { undo } from '../undo';

import type { ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../../models/UndoEntry';

// Audit CC-6 — the undo/redo stack replays `inverseAction` through
// `executeAppAction` but treated every rejection identically, unlike
// `revertAction` which distinguishes them. The two rejections mean opposite
// things:
//
//   * `AppActionConflictError` — the transaction aborted, nothing was written.
//     The entry must stay on the stack so it can be retried.
//   * `AppActionCommittedError` — the CRDT write LANDED; only the bookkeeping
//     after it failed. The stack must advance, or the next undo replays an
//     inverse that has already been applied.
//
// The second case was the damaging one: `undoStore.set` sat after the awaited
// call, so any rejection skipped it and left the entry in `past`.

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
    undoTreeMoveTo: vi.fn<(currentEntryId: string | null) => void>(),
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
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

vi.mock('../executeAppActionBatch', () => ({
    executeAppActionBatch: mocks.executeAppActionBatch,
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
        label: 'Inline Note Move',
        timestamp: 0,
        source: 'manual',
        undo: vi.fn(),
        redo: vi.fn(),
        ...overrides,
    };
}

/** Rejects the inverses named here as guarded conflicts; applies every other. */
function conflictOn(...actionTypes: readonly string[]): void {
    mocks.executeAppAction.mockImplementation(async (action) => {
        if (actionTypes.includes(action.type)) {
            throw new AppActionConflictError(action.type);
        }
    });
}

describe('undo/redo replay conflict handling (audit CC-6)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'executed', actions: [] });
    });

    describe('undo', () => {
        it('advances the stack when the inverse committed but its bookkeeping failed', async () => {
            const entry = actionEntry({ id: 'committed-1' });
            mocks.undoStoreValue.value = { past: [entry], future: [] };
            mocks.executeAppAction.mockRejectedValue(
                new AppActionCommittedError('toggleRecording', new Error('metadata write failed'))
            );

            await expect(undo()).rejects.toBeInstanceOf(AppActionCommittedError);

            // The inverse landed in the document, so the entry must move to
            // `future`. Leaving it in `past` makes the next undo apply the
            // same inverse a second time.
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [entry] });
        });

        it('notifies the user, steps over a conflicting entry and undoes the one beneath it', async () => {
            const older = actionEntry({
                id: 'older-1',
                label: 'First Action',
                inverseAction: { type: 'togglePlayback' },
            });
            const conflicting = actionEntry({ id: 'conflict-1', label: 'Cut Clip' });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            conflictOn('toggleRecording');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // One message per keystroke, naming both the entry that could not be
            // undone and the older one undone in its place. A bare "Cannot undo Cut
            // Clip" would report a failure while First Action was silently reverted,
            // and the next edit clears `future` and makes that revert permanent.
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed. Undid "First Action" instead.',
                'warning'
            );
            // The conflicting entry wrote nothing: it keeps its place in `past` so a
            // later undo retries it, and it never reaches `future` where redo would
            // re-apply an action that was never undone. Pinning it at the top of `past`
            // instead would strand `older-1` there for the rest of the session.
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [conflicting], future: [older] });
            expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('conflict-1');
        });

        it('leaves the stack untouched when every entry beneath the conflict also conflicts', async () => {
            const older = actionEntry({ id: 'older-1', label: 'First Action' });
            const conflicting = actionEntry({ id: 'conflict-1', label: 'Cut Clip' });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('toggleRecording'));

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // Nothing was written for either entry, so both stay undoable and the stack
            // is left exactly as it stood.
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        });

        it('notifies the user and preserves a conflicting action group for retry', async () => {
            const first = actionEntry({ id: 'g-first', groupId: 'group-1', groupLabel: 'Grouped Edit' });
            const second = actionEntry({ id: 'g-second', groupId: 'group-1', groupLabel: 'Grouped Edit' });
            mocks.undoStoreValue.value = { past: [first, second], future: [] };
            mocks.executeAppActionBatch.mockResolvedValue({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: toggleRecording',
                actions: [],
            });

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.executeAppActionBatch).toHaveBeenCalledWith([second.inverseAction, first.inverseAction], {
                skipUndo: true,
                skipMacroRecording: true,
                source: 'manual',
            });
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Grouped Edit": project state has changed',
                'warning'
            );
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        });

        it('steps over a conflicting action group to the entry beneath it', async () => {
            const older = actionEntry({ id: 'older-1', label: 'First Action' });
            const first = actionEntry({ id: 'g-first', groupId: 'group-1', groupLabel: 'Grouped Edit' });
            const second = actionEntry({ id: 'g-second', groupId: 'group-1', groupLabel: 'Grouped Edit' });
            mocks.undoStoreValue.value = { past: [older, first, second], future: [] };
            mocks.executeAppActionBatch.mockResolvedValue({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: toggleRecording',
                actions: [],
            });

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // A group that cannot be undone blocks the history beneath it exactly as a
            // single entry would, so it is reported and stepped over whole.
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Grouped Edit": project state has changed. Undid "First Action" instead.',
                'warning'
            );
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [first, second], future: [older] });
            expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('g-second');
        });

        it('refuses to step over a conflict onto a callback entry', async () => {
            // A callback body is an absolute overwrite captured at edit time — it
            // restores a whole note list or replaces a lane's points. It has no
            // snapshot to check, so it cannot refuse to run against a document that
            // has already diverged; running it would destroy the very change that
            // caused the conflict.
            const callbackUndo = vi.fn();
            const beneath = callbackEntry({ id: 'callback-beneath', undo: callbackUndo });
            const conflicting = actionEntry({ id: 'conflict-1', label: 'Cut Clip' });
            mocks.undoStoreValue.value = { past: [beneath, conflicting], future: [] };
            conflictOn('toggleRecording');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            expect(callbackUndo).not.toHaveBeenCalled();
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed. Older history is blocked until it is resolved.',
                'warning'
            );
        });

        it('steps over at most one conflict per call instead of walking the whole stack', async () => {
            // Every action conflicts while project mutation is inadmissible. An
            // unbounded scan turns one keystroke into an attempt on the entire
            // history — and one eight-second toast per distinct label.
            const third = actionEntry({ id: 'third', label: 'Third', inverseAction: { type: 'togglePlayback' } });
            const second = actionEntry({ id: 'second', label: 'Second', inverseAction: { type: 'toggleLoop' } });
            const head = actionEntry({ id: 'head', label: 'Head' });
            mocks.undoStoreValue.value = { past: [third, second, head], future: [] };
            conflictOn('toggleRecording', 'toggleLoop', 'togglePlayback');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
            expect(mocks.executeAppAction.mock.calls.map(([action]) => action.type)).toEqual([
                'toggleRecording',
                'toggleLoop',
            ]);
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith('Cannot undo "Head": project state has changed', 'warning');
        });

        it('retains a mixed group from its conflicting member down and reports the partial undo', async () => {
            // The callback member makes this group non-atomic, so its members replay
            // one at a time rather than as one batch.
            const older = actionEntry({ id: 'older', label: 'Older', inverseAction: { type: 'togglePlayback' } });
            const first = actionEntry({
                id: 'g-first',
                groupId: 'group-1',
                groupLabel: 'Mixed Edit',
                inverseAction: { type: 'toggleLoop' },
            });
            const middle = actionEntry({ id: 'g-middle', groupId: 'group-1', groupLabel: 'Mixed Edit' });
            const newest = callbackEntry({ id: 'g-newest', groupId: 'group-1', groupLabel: 'Mixed Edit' });
            mocks.undoStoreValue.value = { past: [older, first, middle, newest], future: [] };
            conflictOn('toggleRecording');

            await expect(undo()).resolves.toEqual({ headConsumed: true });

            // The conflicting member wrote nothing, so it and the untried member below
            // it stay on `past`. Only the callback that actually ran reaches `future`.
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [older, first, middle], future: [newest] });
            expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('g-middle');
            // Neither the untried group member nor the entry beneath the group is
            // replayed: a conflict ends the call.
            expect(mocks.executeAppAction.mock.calls.map(([action]) => action.type)).toEqual(['toggleRecording']);
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Only part of "Mixed Edit" could be undone: project state has changed',
                'warning'
            );
        });
    });

    describe('redo', () => {
        it('advances the stack when the redone action committed but its bookkeeping failed', async () => {
            const entry = actionEntry({ id: 'redo-committed-1' });
            mocks.undoStoreValue.value = { past: [], future: [entry] };
            mocks.executeAppAction.mockRejectedValue(
                new AppActionCommittedError('togglePlayback', new Error('metadata write failed'))
            );

            await expect(redo()).rejects.toBeInstanceOf(AppActionCommittedError);

            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [entry], future: [] });
        });

        it('leaves a conflicting entry in future and does not reject', async () => {
            const entry = actionEntry({ id: 'redo-conflict-1' });
            mocks.undoStoreValue.value = { past: [], future: [entry] };
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('togglePlayback'));

            await expect(redo()).resolves.toBeUndefined();

            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        });
    });
});
