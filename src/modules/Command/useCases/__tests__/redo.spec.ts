import { describe, it, expect, vi, beforeEach } from 'vitest';

import { redo } from '../redo';
import { REDO_NOT_APPLIED } from '../redoResult';

import type { ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../../models/UndoEntry';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
    undoTreeMoveTo: vi.fn<(currentEntryId: string | null) => void>(),
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
        label: 'Callback',
        timestamp: 0,
        source: 'manual',
        undo: vi.fn(),
        redo: vi.fn(),
        ...overrides,
    };
}

describe('redo', () => {
    beforeEach(() => {
        mocks.undoStoreSet.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('replays the original action with normal macro-recording semantics and moves it back to past', async () => {
        const entry = actionEntry();
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'togglePlayback' });
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [entry],
            future: [],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('e1');
    });

    it('uses a guarded redo action when recomputing the original action would be unsafe', async () => {
        const guardedRedo = { type: 'stopPlayback' as const };
        const entry = actionEntry({ redoAction: guardedRedo, source: 'ai' });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(guardedRedo, {
            skipUndo: true,
            skipMacroRecording: true,
            source: 'ai',
        });
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [entry], future: [] });
    });

    it('should run callback redo entries without action replay', async () => {
        const redoFn = vi.fn();
        const entry = callbackEntry({ redo: redoFn });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(redoFn).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [entry],
            future: [],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('callback-1');
    });

    it('consumes a callback entry that reports it was not applied, keeping past unchanged', async () => {
        const entry = callbackEntry({ redo: () => REDO_NOT_APPLIED });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        // Dropped from future without reaching past — pinning it would deadlock
        // every redoable entry behind it.
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });

    it('drops a not-applied head and re-applies the entry behind it', async () => {
        const stuck = callbackEntry({ redo: () => REDO_NOT_APPLIED });
        const behind = actionEntry();
        mocks.undoStoreValue.value = { past: [], future: [stuck, behind] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(behind.action);
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [behind], future: [] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(behind.id);
    });

    it('should not write when future is empty', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry()], future: [] };

        await redo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });
});
