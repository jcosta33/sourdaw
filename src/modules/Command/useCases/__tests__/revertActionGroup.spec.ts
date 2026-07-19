import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertActionGroup } from '../revertActionGroup';

import type { ActionUndoEntry, UndoEntry } from '../../models/UndoEntry';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        } as import('../../stores/undoStore').UndoStoreState | null,
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi
        .fn<typeof import('../executeAppActionImpl').executeAppActionImpl>()
        .mockResolvedValue(undefined),
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

vi.mock('../executeAppActionImpl', () => ({
    executeAppActionImpl: mocks.executeAppAction,
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

function adjustmentEntry(id: string, mix: number, previous: number): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'ai',
        groupId: 'g1',
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
    };
}

describe('revertActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('reverts an adjustment group through one owning aggregate inverse and rebuilds the split', async () => {
        const other = actionEntry('keep', 'g0');
        const g1 = adjustmentEntry('1', 0.5, 0.25);
        const g2 = adjustmentEntry('2', 0.75, 0.5);
        mocks.undoStoreValue.value = { past: [other, g1, g2], future: [] };

        await expect(revertActionGroup('g1')).resolves.toBe(true);

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'restoreAdjustmentLayerMutationBatch',
                payload: { mutations: [g2.inverseAction?.payload, g1.inverseAction?.payload] },
            },
            { skipUndo: true, skipMacroRecording: true }
        );
        // Group entries are stripped from past and prepended (in order) to future.
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [other],
            future: [
                { ...g1, transactionGroupId: 'g1' },
                { ...g2, transactionGroupId: 'g1' },
            ],
        });
        // Undo-tree position follows the new top of past.
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('keep');
    });

    it('moves the undo tree to root when the group was the entire past stack', async () => {
        const g1 = actionEntry('1', 'g1');
        mocks.undoStoreValue.value = { past: [g1], future: [] };

        await expect(revertActionGroup('g1')).resolves.toBe(true);

        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('refuses a non-transactional multi-entry group before replay', async () => {
        const older = actionEntry('older', 'g1');
        const newer = actionEntry('newer', 'g1');
        if (older.kind !== 'action' || newer.kind !== 'action') {
            throw new Error('Expected action entries');
        }
        older.action = { type: 'togglePlayback' };
        older.inverseAction = { type: 'toggleRecording' };
        newer.action = { type: 'toggleLoop' };
        newer.inverseAction = { type: 'stopPlayback' };
        let domain_value = 'original';
        mocks.executeAppAction.mockImplementation((action) => {
            if (action.type === 'stopPlayback') {
                domain_value = 'partially-undone';
                return Promise.resolve();
            }
            return Promise.resolve();
        });
        mocks.undoStoreValue.value = { past: [older, newer], future: [] };

        await expect(revertActionGroup('g1')).resolves.toBe(false);

        expect(domain_value).toBe('original');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
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

        await expect(revertActionGroup('g1')).resolves.toBe(false);

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('is a no-op when the group is absent from past', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry('a', 'gX')], future: [] };

        await expect(revertActionGroup('g1')).resolves.toBe(false);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
    });
});
