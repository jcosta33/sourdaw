import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type UndoEntry } from '../../models/UndoEntry';
import { revertActionGroupsAtomically } from '../revertActionGroupAtomically';

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
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
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

function groupEntry(id: string, groupId: string, trackId: string): Extract<UndoEntry, { kind: 'action' }> {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'ai',
        groupId,
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'setTrackPan', payload: { trackId, pan: 0, expectedPan: 0.5 } },
    };
}

describe('revertActionGroupsAtomically', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
        mocks.executeAppActionBatch.mockImplementation(async (actions, options) => {
            options?.onCommitted?.(actions);
            return { status: 'committed', actions: [] };
        });
    });

    it('replays two groups as one batch, newest-first across both, and moves both to future', async () => {
        const kept = groupEntry('kept', 'g0', 'track-k');
        const first = groupEntry('first', 'g1', 'track-a');
        const between = groupEntry('between', 'g2', 'track-b');
        const last = groupEntry('last', 'g1', 'track-c');
        mocks.undoStoreValue.value = { past: [first, kept, between, last], future: [] };

        await expect(revertActionGroupsAtomically(['g1', 'g2'])).resolves.toEqual({
            status: 'reverted',
            warning: null,
        });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledExactlyOnceWith(
            [last.inverseAction, between.inverseAction, first.inverseAction],
            expect.objectContaining({ undoEntryIds: [last.id, between.id, first.id] })
        );
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledExactlyOnceWith({ past: [kept], future: [first, between, last] });
    });

    it.each([
        ['absent from past', { past: [groupEntry('a', 'g1', 'track-a')], future: [] }],
        [
            'held partly in future',
            {
                past: [groupEntry('a', 'g1', 'track-a'), groupEntry('b', 'g2', 'track-b')],
                future: [groupEntry('c', 'g2', 'track-c')],
            },
        ],
    ])('writes nothing when one group is %s', async (_label, history) => {
        mocks.undoStoreValue.value = history;

        await expect(revertActionGroupsAtomically(['g1', 'g2'])).resolves.toMatchObject({
            status: 'refused',
            reason: 'not-applied',
        });

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
    });

    it('refuses an empty set of groups without replaying anything', async () => {
        mocks.undoStoreValue.value = { past: [groupEntry('a', 'g1', 'track-a')], future: [] };

        await expect(revertActionGroupsAtomically([])).resolves.toMatchObject({
            status: 'refused',
            reason: 'not-applied',
        });

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('writes nothing for either group when one inverse conflicts', async () => {
        mocks.undoStoreValue.value = {
            past: [groupEntry('a', 'g1', 'track-a'), groupEntry('b', 'g2', 'track-gone')],
            future: [],
        };
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setTrackPan',
            actions: [],
        });

        await expect(revertActionGroupsAtomically(['g1', 'g2'])).resolves.toEqual({
            status: 'refused',
            reason: 'conflict',
            detail: 'Action conflicts with current project state: setTrackPan',
        });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });
});
