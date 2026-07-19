import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undo } from '../undo';

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

describe('undo', () => {
    beforeEach(() => {
        mocks.undoStoreSet.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('should execute inverseAction with skipUndo and move the entry to future', async () => {
        const entry = actionEntry();
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [],
            future: [entry],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('should run callback undo entries without action replay', async () => {
        const undoFn = vi.fn();
        const entry = callbackEntry({ undo: undoFn });
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await undo();

        expect(undoFn).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [],
            future: [entry],
        });
    });

    it('should undo a whole group newest-first and move it to future in original order', async () => {
        const previous = actionEntry({ id: 'previous' });
        const first = actionEntry({
            id: 'group-1',
            label: 'First',
            action: { type: 'togglePlayback' },
            inverseAction: { type: 'toggleRecording' },
            groupId: 'group',
        });
        const second = actionEntry({
            id: 'group-2',
            label: 'Second',
            action: { type: 'toggleLoop' },
            inverseAction: { type: 'stopPlayback' },
            groupId: 'group',
        });
        const future = actionEntry({ id: 'future' });
        mocks.undoStoreValue.value = { past: [previous, first, second], future: [future] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            { type: 'stopPlayback' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [previous],
            future: [first, second, future],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('previous');
    });

    it('rolls back completed group inverses when an older inverse rejects', async () => {
        const failure = new Error('older inverse conflict');
        const older = actionEntry({
            id: 'older',
            action: { type: 'togglePlayback' },
            inverseAction: { type: 'toggleRecording' },
            groupId: 'group',
        });
        const newer = actionEntry({
            id: 'newer',
            action: { type: 'toggleLoop' },
            inverseAction: { type: 'stopPlayback' },
            groupId: 'group',
        });
        let domain_value = 'original';
        mocks.executeAppAction.mockImplementation((action) => {
            if (action.type === 'stopPlayback') {
                domain_value = 'partially-undone';
                return Promise.resolve();
            }
            if (action.type === 'toggleRecording') {
                throw failure;
            }
            if (action.type === 'toggleLoop') {
                domain_value = 'original';
            }
            return Promise.resolve();
        });
        mocks.undoStoreValue.value = { past: [older, newer], future: [] };

        await expect(undo()).rejects.toBe(failure);

        expect(domain_value).toBe('original');
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(3, newer.action, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('should not consume an inert action entry without an inverseAction', async () => {
        const entry = actionEntry({ inverseAction: null });
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await undo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value).toEqual({ past: [entry], future: [] });
    });

    it('should serialize overlapping undo calls so one entry is not popped twice', async () => {
        const entry = actionEntry();
        mocks.undoStoreSet.mockImplementation((next) => {
            mocks.undoStoreValue.value = next;
        });
        mocks.executeAppAction.mockImplementation(async () => {
            await Promise.resolve();
        });
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await Promise.all([undo(), undo()]);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreSet).toHaveBeenCalledTimes(1);
        expect(mocks.undoStoreValue.value).toEqual({ past: [], future: [entry] });
    });
});
