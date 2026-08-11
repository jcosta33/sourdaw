import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionCommittedError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
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
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
    recordAction: vi.fn(),
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

vi.mock('../macro/recording/recordAction', () => ({
    recordAction: mocks.recordAction,
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
        mocks.executeAppActionBatch.mockReset();
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
        mocks.recordAction.mockReset();
        mocks.undoTreeMoveTo.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
        clearHandlerRegistry();
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

    it('does not record an ungrouped AI redo into a user macro', async () => {
        const entry = actionEntry({ source: 'ai' });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await redo();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(entry.action, {
            skipMacroRecording: true,
            source: 'ai',
        });
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [entry], future: [] });
    });

    it('replays a contiguous action group atomically in forward order', async () => {
        const groupId = 'ai-midi-group';
        const first = actionEntry({
            id: 'track-entry',
            groupId,
            source: 'ai',
            action: { type: 'addTrack', payload: { id: 'track-ai', name: 'AI MIDI', kind: 'midi' } },
        });
        const second = actionEntry({
            id: 'clip-entry',
            groupId,
            source: 'ai',
            action: {
                type: 'addClip',
                payload: { trackId: 'track-ai', startBeat: 0, endBeat: 4, name: 'AI Clip', type: 'midi' },
            },
            redoAction: {
                type: 'addClip',
                payload: {
                    id: 'clip-ai',
                    trackId: 'track-ai',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'AI Clip',
                    type: 'midi',
                },
            },
        });
        const third = actionEntry({
            id: 'notes-entry',
            groupId,
            source: 'ai',
            action: {
                type: 'addNotes',
                payload: { clipId: 'clip-ai', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
            },
        });
        mocks.undoStoreValue.value = { past: [], future: [first, second, third] };

        await redo();

        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith([first.action, second.redoAction, third.action], {
            skipUndo: true,
            skipMacroRecording: true,
            source: 'ai',
        });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [first, second, third], future: [] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('notes-entry');
    });

    it('de-groups legacy mixed singleton history before redoing only the first entry', async () => {
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
        mocks.undoStoreValue.value = { past: [], future: [singleton, companion] };

        await redo();

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(singleton.action);
        expect(mocks.undoStoreSet).toHaveBeenLastCalledWith({
            past: [expect.not.objectContaining({ groupId: 'legacy-group' })],
            future: [expect.not.objectContaining({ groupId: 'legacy-group' })],
        });
    });

    it('keeps an entire grouped redo pending when its atomic batch conflicts', async () => {
        const first = actionEntry({ id: 'group-1', groupId: 'group' });
        const second = actionEntry({ id: 'group-2', groupId: 'group' });
        mocks.undoStoreValue.value = { past: [], future: [first, second] };
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'conflicted', reason: 'stale', actions: [] });

        await redo();

        expect(mocks.executeAppActionBatch).toHaveBeenCalledOnce();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('advances a committed group but reports its post-commit warning', async () => {
        const first = actionEntry({ id: 'group-1', groupId: 'group', source: 'ai' });
        const second = actionEntry({ id: 'group-2', groupId: 'group', source: 'ai' });
        mocks.undoStoreValue.value = { past: [], future: [first, second] };
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'committed-with-warning',
            warning: 'runtime reconciliation failed',
            actions: [],
        });

        await expect(redo()).rejects.toBeInstanceOf(AppActionCommittedError);

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [first, second], future: [] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('group-2');
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

    it('retains callback history when guarded redo rejects current state', async () => {
        const conflict = new Error('stale project state');
        const entry = callbackEntry({
            redo: () => {
                throw conflict;
            },
        });
        mocks.undoStoreValue.value = { past: [], future: [entry] };

        await expect(redo()).rejects.toBe(conflict);

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value).toEqual({ past: [], future: [entry] });
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
