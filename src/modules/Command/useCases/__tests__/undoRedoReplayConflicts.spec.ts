import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { redo } from '../redo';
import { undo } from '../undo';

import type { ActionUndoEntry, UndoEntry } from '../../models/UndoEntry';

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

        it('notifies the user and preserves a conflicting entry for retry', async () => {
            const older = actionEntry({ id: 'older-1', label: 'First Action' });
            const conflicting = actionEntry({ id: 'conflict-1', label: 'Cut Clip' });
            mocks.undoStoreValue.value = { past: [older, conflicting], future: [] };
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('toggleRecording'));

            await expect(undo()).resolves.toBeUndefined();

            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Cannot undo "Cut Clip": project state has changed',
                'warning'
            );
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

            await expect(undo()).resolves.toBeUndefined();

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
