import { describe, it, expect, vi, beforeEach } from 'vitest';

import { propagateParentChanges } from '../propagateParentChanges';

const mocks = vi.hoisted(() => {
    const trackStoreValue: unknown = null;
    return {
        trackStoreValue,
        getNotesForClip: vi.fn<() => unknown[]>(() => []),
        setNotesForClip: vi.fn<(...args: unknown[]) => void>(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
}));
vi.mock('../../../useCases/midiNoteCrud/getNotesForClip', () => ({ getNotesForClip: mocks.getNotesForClip }));
vi.mock('../../../useCases/midiNoteCrud/setNotesForClip', () => ({ setNotesForClip: mocks.setNotesForClip }));

describe('propagateParentChanges', () => {
    beforeEach(() => vi.clearAllMocks());

    it('clones parent notes onto a linked instance, offsetting by the instance start beat', () => {
        const parentClip = { id: 'parent', startBeat: 0 };
        const instanceClip = { id: 'inst-1', startBeat: 16, parentClipId: 'parent' };
        mocks.trackStoreValue = { tracks: [{ id: 't1', clips: [parentClip, instanceClip] }] };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 1, pitch: 60 }]);

        propagateParentChanges('parent');

        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-1', [
            expect.objectContaining({ pitch: 60, startBeat: 17, id: 'note-inst-inst-1-n1' }),
        ]);
    });

    it('propagates to every linked instance across tracks, not just the first', () => {
        const parentClip = { id: 'parent', startBeat: 0 };
        const inst1 = { id: 'inst-1', startBeat: 16, parentClipId: 'parent' };
        const inst2 = { id: 'inst-2', startBeat: 32, parentClipId: 'parent' };
        mocks.trackStoreValue = {
            tracks: [
                { id: 't1', clips: [parentClip, inst1] },
                { id: 't2', clips: [inst2] },
            ],
        };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 0, pitch: 60 }]);

        propagateParentChanges('parent');

        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(2);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-1', [expect.objectContaining({ startBeat: 16 })]);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-2', [expect.objectContaining({ startBeat: 32 })]);
    });

    it.each([
        {
            label: 'the instance overrides its own notes',
            extraClip: { id: 'inst-1', startBeat: 16, parentClipId: 'parent', overrides: { notes: true } },
        },
        {
            label: "the clip's parentClipId does not match the given parent",
            extraClip: { id: 'other', startBeat: 16, parentClipId: 'someone-else' },
        },
    ])('skips a clip when $label', ({ extraClip }) => {
        const parentClip = { id: 'parent', startBeat: 0 };
        mocks.trackStoreValue = { tracks: [{ id: 't1', clips: [parentClip, extraClip] }] };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 0, pitch: 60 }]);

        propagateParentChanges('parent');

        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('does nothing when the parent clip cannot be found or the track store is unavailable', () => {
        mocks.trackStoreValue = { tracks: [{ id: 't1', clips: [{ id: 'unrelated', startBeat: 0 }] }] };
        propagateParentChanges('missing-parent');
        expect(mocks.getNotesForClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();

        mocks.trackStoreValue = null;
        propagateParentChanges('parent');
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });
});
