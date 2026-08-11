import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
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
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
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
        mocks.executeAppActionBatch.mockReset();
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'executed', actions: [] });
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
        clearHandlerRegistry();
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

    it('retains callback history when guarded undo rejects current state', async () => {
        const conflict = new Error('stale project state');
        const entry = callbackEntry({
            undo: () => {
                throw conflict;
            },
        });
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await expect(undo()).rejects.toBe(conflict);

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value).toEqual({ past: [entry], future: [] });
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

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [{ type: 'stopPlayback' }, { type: 'toggleRecording' }],
            { skipUndo: true, skipMacroRecording: true, source: 'manual' }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [previous],
            future: [first, second, future],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('previous');
    });

    it('de-groups legacy mixed singleton history before undoing only the newest entry', async () => {
        registerHandlerMap({
            setEditingTool: {
                batchExecution: 'singleton',
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'Set editing tool', inverseAction: null }),
                undoable: true,
            },
        });
        const singleton = actionEntry({
            id: 'singleton',
            action: { type: 'setEditingTool', payload: { tool: 'marquee' } },
            inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
            groupId: 'legacy-group',
            groupLabel: 'Legacy group',
        });
        const companion = actionEntry({
            id: 'companion',
            action: { type: 'toggleLoop' },
            inverseAction: { type: 'toggleLoop' },
            groupId: 'legacy-group',
            groupLabel: 'Legacy group',
        });
        mocks.undoStoreValue.value = { past: [singleton, companion], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(companion.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        expect(mocks.undoStoreSet).toHaveBeenLastCalledWith({
            past: [expect.not.objectContaining({ groupId: 'legacy-group' })],
            future: [expect.not.objectContaining({ groupId: 'legacy-group' })],
        });
    });

    it('should drop an inert action entry instead of leaving it to wedge the stack', async () => {
        const entry = actionEntry({ inverseAction: null });
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await undo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('should skip an inert top entry and undo the undoable entry beneath it', async () => {
        const undoable = actionEntry({ id: 'undoable' });
        const inert = actionEntry({ id: 'inert', inverseAction: null });
        mocks.undoStoreValue.value = { past: [undoable, inert], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        // The inert entry is dropped without reaching future: nothing was undone for
        // it, so redo must never re-apply its action.
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [undoable] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('should drop a fully inert group and undo the entry beneath it', async () => {
        const undoable = actionEntry({ id: 'undoable' });
        const inert_one = actionEntry({ id: 'inert-1', inverseAction: null, groupId: 'group' });
        const inert_two = actionEntry({ id: 'inert-2', inverseAction: null, groupId: 'group' });
        mocks.undoStoreValue.value = { past: [undoable, inert_one, inert_two], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [undoable] });
    });

    it('should move only the undoable entries of a mixed group to future', async () => {
        const previous = actionEntry({ id: 'previous' });
        const inert = actionEntry({ id: 'inert', inverseAction: null, groupId: 'group' });
        const real = actionEntry({
            id: 'real',
            action: { type: 'toggleLoop' },
            inverseAction: { type: 'stopPlayback' },
            groupId: 'group',
        });
        mocks.undoStoreValue.value = { past: [previous, inert, real], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'stopPlayback' },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [previous], future: [real] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('previous');
    });

    it('should empty a stack of only inert entries without touching future', async () => {
        const inert_one = actionEntry({ id: 'inert-1', inverseAction: null });
        const inert_two = actionEntry({ id: 'inert-2', inverseAction: null });
        const future = actionEntry({ id: 'future' });
        mocks.undoStoreValue.value = { past: [inert_one, inert_two], future: [future] };

        await undo();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [future] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
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
