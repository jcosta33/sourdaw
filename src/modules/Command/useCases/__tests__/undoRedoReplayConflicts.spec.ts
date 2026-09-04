import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';

import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
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
//
// #2881 extends the conflict arm: a conflicted head no longer wedges the whole
// history behind it. Undo steps over it onto the unit beneath — but only when
// that unit's inverse resolves to a handler flagged `canReportConflict`, so the
// production handler maps are registered here exactly as bootstrap registers
// them and the gate reads real capability flags.

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
    admissionFailure: null as string | null,
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

vi.mock('../isProjectMutationAllowed', () => ({
    getProjectMutationAdmissionFailure: () => mocks.admissionFailure,
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

/** An inverse whose handler is flagged `canReportConflict` — steppable (#2881). */
const conflictCapableFadeInverse = {
    type: 'setClipFade',
    payload: { clipId: 'clip-1', fadeInBeats: 0, fadeOutBeats: 0, expectedFadeInBeats: 0, expectedFadeOutBeats: 0 },
} as const;

/** A conflicting head's inverse, also conflict-capable. */
const conflictCapableGainInverse = {
    type: 'setTrackGain',
    payload: { trackId: 'track-1', gain: 0.5, expectedGain: 0.8 },
} as const;

describe('undo/redo replay conflict handling (audit CC-6)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'executed', actions: [] });
        mocks.admissionFailure = null;
        // The step-over gate resolves inverse handlers through the live
        // registry, so the capability flags it reads must be the production
        // ones. Only the Arrangement map is registered — it owns the whole
        // flagged first set — which leaves the Transport toggle inverses used
        // by the fixtures below unregistered: they resolve to no handler, so
        // the gate treats them as unsteppable, which is exactly what those
        // fixtures assert.
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
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

        it('reverts nothing when the head conflicts, and never reaches the entry beneath it', async () => {
            const older = actionEntry({
                id: 'older-1',
                label: 'First Action',
                inverseAction: { type: 'togglePlayback' },
            });
            const conflicting = actionEntry({ id: 'conflict-1', label: 'Cut Clip' });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            conflictOn('toggleRecording');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // Only the head's inverse is attempted. The step-over gate (#2881)
            // admits the unit beneath only when its inverse handler is flagged
            // `canReportConflict`; `togglePlayback`'s handler is not flagged —
            // it cannot refuse to write — so `First Action` must not be
            // replayed over the edit that caused the conflict. The conflicted
            // entry keeps its place in `past` and never reaches `future`, where
            // redo would re-apply an action that was never undone.
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'toggleRecording' }, expect.anything());
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed',
                'warning'
            );
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

        it('leaves the entry beneath a conflicting action group untouched', async () => {
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
            // single entry does: the whole group stays on `past` and `older-1` is never
            // replayed.
            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Grouped Edit": project state has changed',
                'warning'
            );
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
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

        it('steps over a conflicted head onto a conflict-capable unit beneath it and undoes that one (#2881)', async () => {
            const older = actionEntry({
                id: 'older-1',
                label: 'First Action',
                inverseAction: conflictCapableFadeInverse,
            });
            const conflicting = actionEntry({
                id: 'conflict-1',
                label: 'Cut Clip',
                inverseAction: conflictCapableGainInverse,
            });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            conflictOn('setTrackGain');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // The conflicted head is attempted, then exactly one step onto the
            // conflict-capable unit beneath it — whose inverse handler can
            // genuinely refuse, so replaying it can never clobber the edit that
            // caused the conflict.
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
            expect(mocks.executeAppAction.mock.calls.map(([action]) => action.type)).toEqual([
                'setTrackGain',
                'setClipFade',
            ]);
            // The step target moved to `future`; the conflicted head stays on
            // `past`, still heading the stack and retryable, so a history sweep
            // still stops on it (`headConsumed: false`).
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [conflicting], future: [older] });
            expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('conflict-1');
            expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
                'Cannot undo "Cut Clip": project state has changed',
                'Skipped "Cut Clip": project state has changed; undid "First Action"',
            ]);
        });

        it('never steps onto a unit whose inverse handler is not flagged conflict-capable', async () => {
            const older = actionEntry({
                id: 'older-1',
                label: 'First Action',
                inverseAction: { type: 'togglePlayback' },
            });
            const conflicting = actionEntry({
                id: 'conflict-1',
                label: 'Cut Clip',
                inverseAction: conflictCapableGainInverse,
            });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            conflictOn('setTrackGain');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // `togglePlayback` cannot refuse to write, so replaying it over the
            // diverged document would silently overwrite the conflicting edit.
            // Only the head is attempted and nothing moves.
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            expect(mocks.executeAppAction).toHaveBeenCalledWith(conflictCapableGainInverse, expect.anything());
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed',
                'warning'
            );
        });

        it('never steps onto a callback entry beneath a conflicted action entry', async () => {
            const callback = callbackEntry({ id: 'cb-1', label: 'Inline Note Move' });
            const conflicting = actionEntry({
                id: 'conflict-1',
                label: 'Cut Clip',
                inverseAction: conflictCapableGainInverse,
            });
            mocks.undoStoreValue.value = { past: [callback, conflicting], future: [] };
            conflictOn('setTrackGain');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // A callback undo reports success unconditionally — it has no
            // handler that could refuse — so the gate must leave it untouched
            // rather than run it over the diverged document.
            expect(callback.undo).not.toHaveBeenCalled();
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        });

        it('attempts no inverse at all while project mutation admission fails', async () => {
            mocks.admissionFailure = 'Project repair is required before project actions can execute';
            const older = actionEntry({
                id: 'older-1',
                label: 'First Action',
                inverseAction: conflictCapableFadeInverse,
            });
            const conflicting = actionEntry({
                id: 'conflict-1',
                label: 'Cut Clip',
                inverseAction: conflictCapableGainInverse,
            });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // Under a global admission gate every inverse would refuse on
            // admission alone, before any handler runs — attempting one, or
            // stepping past it, is pointless churn. The same blocked-undo
            // notification is reported once and nothing is written.
            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed',
                'warning'
            );
        });

        it('touches at most two units per call, stopping after one step even when that unit conflicts too', async () => {
            const deepest = actionEntry({
                id: 'deep-1',
                label: 'Deep Action',
                inverseAction: { type: 'setClipColor', payload: { clipId: 'clip-1', color: '#00ff00' } },
            });
            const middle = actionEntry({
                id: 'middle-1',
                label: 'First Action',
                inverseAction: conflictCapableFadeInverse,
            });
            const conflicting = actionEntry({
                id: 'conflict-1',
                label: 'Cut Clip',
                inverseAction: conflictCapableGainInverse,
            });
            mocks.undoStoreValue.value = { past: [deepest, middle, conflicting], future: [] };
            conflictOn('setTrackGain', 'setClipFade');

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // One keystroke touches at most two units: the conflicted head and
            // the one step target. When the target refuses as well there is no
            // recursion and no third attempt — `Deep Action` is never replayed —
            // both conflicted units stay on `past` retryable, nothing moves, and
            // the head's conflict message is the only notification.
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
            expect(mocks.executeAppAction.mock.calls.map(([action]) => action.type)).toEqual([
                'setTrackGain',
                'setClipFade',
            ]);
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed',
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
