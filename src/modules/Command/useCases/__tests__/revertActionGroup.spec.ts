import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertActionGroup } from '../revertActionGroup';
import { runUndoRedoExclusive } from '../undoRedo';

import type { UndoEntry } from '../../models/UndoEntry';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>().mockResolvedValue(undefined),
    undoTreeMoveTo: vi.fn<(id: string | null) => void>(),
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

function actionEntry(id: string, groupId: string | undefined): UndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'ai',
        groupId,
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
    };
}

describe('revertActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('reverts every entry newest-first without undo or macro recording and rebuilds the split', async () => {
        const other = actionEntry('keep', 'g0');
        const g1 = actionEntry('1', 'g1');
        const g2 = actionEntry('2', 'g1');
        mocks.undoStoreValue.value = { past: [other, g1, g2], future: [] };

        await revertActionGroup('g1');

        // Inverse replays must not push fresh undo entries or leak into macro recording.
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        // Group entries are stripped from past and prepended (in order) to future.
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [other],
            future: [g1, g2],
        });
        // Undo-tree position follows the new top of past.
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('keep');
    });

    it('moves the undo tree to root when the group was the entire past stack', async () => {
        const g1 = actionEntry('1', 'g1');
        mocks.undoStoreValue.value = { past: [g1], future: [] };

        await revertActionGroup('g1');

        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('leaves the store untouched when no member of the group could be undone', async () => {
        const inert: UndoEntry = {
            kind: 'action',
            id: 'x',
            label: 'x',
            timestamp: 0,
            source: 'ai',
            groupId: 'g1',
            action: { type: 'togglePlayback' },
            inverseAction: null,
        };
        mocks.undoStoreValue.value = { past: [inert], future: [] };

        await revertActionGroup('g1');

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('is a no-op when the group is absent from past', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry('a', 'gX')], future: [] };

        await revertActionGroup('g1');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
    });

    it('waits behind an in-flight undo mutation before reading or reverting the group', async () => {
        const group = actionEntry('1', 'g1');
        mocks.undoStoreValue.value = { past: [group], future: [] };
        let releaseMutation: (() => void) | undefined;
        const mutationGate = new Promise<void>((resolve) => {
            releaseMutation = resolve;
        });
        const inFlightMutation = runUndoRedoExclusive(async () => mutationGate);

        const revert = revertActionGroup('g1');
        await Promise.resolve();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        releaseMutation?.();
        await Promise.all([inFlightMutation, revert]);
        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
    });

    it('preserves an action committed while a group inverse is in flight', async () => {
        const other = actionEntry('keep', 'g0');
        const group = actionEntry('group', 'g1');
        const concurrent = actionEntry('concurrent', 'g2');
        mocks.undoStoreValue.value = { past: [other, group], future: [] };
        mocks.executeAppAction.mockImplementationOnce(() => {
            mocks.undoStoreValue.value = { past: [other, group, concurrent], future: [] };
            return Promise.resolve(undefined);
        });

        await revertActionGroup('g1');

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [other, concurrent],
            future: [group],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('concurrent');
    });
});
