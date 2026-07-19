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
    executeAppAction: vi.fn<typeof import('../executeAppActionImpl').executeAppActionImpl>(),
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

vi.mock('../executeAppActionImpl', () => ({
    executeAppActionImpl: mocks.executeAppAction,
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

function adjustmentEntry(id: string, mix: number, previous: number): ActionUndoEntry {
    return actionEntry({
        id,
        groupId: 'group',
        transactionGroupId: 'group',
        action: { type: 'setLayerMix', payload: { layerId: 'layer-1', mix } },
        inverseAction: {
            type: 'restoreAdjustmentLayerMutation',
            payload: {
                adjustmentMutationId: `mutation-${id}`,
                operation: {
                    kind: 'restore-mix',
                    layerId: 'layer-1',
                    previous,
                    expected: mix,
                },
                staleTransitions: [],
            },
        },
    });
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

    it('uses one owning aggregate inverse for an adjustment-layer group', async () => {
        const previous = actionEntry({ id: 'previous' });
        const first = adjustmentEntry('group-1', 0.5, 0.25);
        const second = adjustmentEntry('group-2', 0.75, 0.5);
        const future = actionEntry({ id: 'future' });
        mocks.undoStoreValue.value = { past: [previous, first, second], future: [future] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'restoreAdjustmentLayerMutationBatch',
                payload: {
                    mutations: [second.inverseAction?.payload, first.inverseAction?.payload],
                },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [previous],
            future: [first, second, future],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('previous');
    });

    it('treats correlation-only entries as individual undo operations', async () => {
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
            return Promise.resolve();
        });
        mocks.undoStoreValue.value = { past: [older, newer], future: [] };

        await undo();

        expect(domain_value).toBe('partially-undone');
        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(newer.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [older], future: [newer] });
    });

    it('does not let correlation metadata turn a mixed group into a blocked transaction', async () => {
        const adjustment = adjustmentEntry('adjustment', 0.75, 0.25);
        Object.assign(adjustment, { transactionGroupId: 'group' });
        const unrelated = actionEntry({
            id: 'unrelated',
            groupId: 'group',
            action: { type: 'togglePlayback' },
            inverseAction: { type: 'toggleRecording' },
        });
        mocks.undoStoreValue.value = { past: [adjustment, unrelated], future: [] };

        await undo();

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(unrelated.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [adjustment], future: [unrelated] });
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
