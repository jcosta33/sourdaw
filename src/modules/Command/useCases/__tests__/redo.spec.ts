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
        mocks.executeAppAction.mockImplementation((_action, options) => {
            options?.onUndoPrepared?.({ label: 'Test', inverseAction: { type: 'toggleRecording' } });
            return Promise.resolve();
        });
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('replays the original action with normal macro-recording semantics and moves it back to past', async () => {
        const entry = actionEntry();
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction.mock.calls[0]?.[0]).toEqual({ type: 'togglePlayback' });
        const redo_options = mocks.executeAppAction.mock.calls[0]?.[1];
        expect(redo_options?.skipUndo).toBe(true);
        expect(typeof redo_options?.onUndoPrepared).toBe('function');
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [entry],
            future: [],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('e1');
    });

    it('replaces the stale inverse with the pre-redo inverse without adding a second past entry', async () => {
        const entry = actionEntry();
        const fresh_inverse = { type: 'setTempo', payload: { bpm: 90 } } as const;
        mocks.executeAppAction.mockImplementation((_action, options) => {
            options?.onUndoPrepared?.({ label: 'Fresh replay', inverseAction: fresh_inverse });
            return Promise.resolve();
        });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.undoStoreSet).toHaveBeenCalledOnce();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [{ ...entry, label: 'Fresh replay', inverseAction: fresh_inverse }],
            future: [],
        });
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

    it('keeps a callback entry in future when redo reports that it was not applied', async () => {
        const entry = callbackEntry({ redo: () => REDO_NOT_APPLIED });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('should not write when future is empty', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry()], future: [] };

        await redo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });
});
