import { describe, it, expect, vi, beforeEach } from 'vitest';

import { propagateParentChanges } from '../propagateParentChanges';

const mocks = vi.hoisted(() => {
    const trackStoreValue: unknown = null;
    return {
        trackStoreValue,
        getNotesForClip: vi.fn<() => unknown[]>(() => []),
        setNotesForClip: vi.fn<(...args: unknown[]) => void>(),
        updateClipInStore: vi.fn<(clipId: string, updater: (clip: unknown) => unknown) => boolean>(() => true),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
    updateClipInStore: mocks.updateClipInStore,
}));
vi.mock('../../../useCases/midiNoteCrud/getNotesForClip', () => ({ getNotesForClip: mocks.getNotesForClip }));
vi.mock('../../../useCases/midiNoteCrud/setNotesForClip', () => ({ setNotesForClip: mocks.setNotesForClip }));

describe('propagateParentChanges', () => {
    beforeEach(() => vi.clearAllMocks());

    it("clones parent notes onto a linked instance, keeping the parent's clip-relative beats", () => {
        const parentClip = { id: 'parent', startBeat: 0 };
        const instanceClip = { id: 'inst-1', startBeat: 16, parentClipId: 'parent' };
        mocks.trackStoreValue = { tracks: [{ id: 't1', clips: [parentClip, instanceClip] }] };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 1, pitch: 60 }]);

        propagateParentChanges('parent');

        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-1', [
            expect.objectContaining({ pitch: 60, startBeat: 1, id: 'note-inst-inst-1-n1' }),
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
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-1', [expect.objectContaining({ startBeat: 0 })]);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('inst-2', [expect.objectContaining({ startBeat: 0 })]);
    });

    /// Regression (PR #608 review): the instance must carry the parent's
    /// midiOffsetBeats or slipped parents play displaced.
    it('mirrors the parent midiOffsetBeats onto instances whose offset differs', () => {
        const parentClip = { id: 'parent', startBeat: 0, midiOffsetBeats: 2 };
        const slipped = { id: 'inst-1', startBeat: 16, parentClipId: 'parent' };
        const aligned = { id: 'inst-2', startBeat: 32, parentClipId: 'parent', midiOffsetBeats: 2 };
        mocks.trackStoreValue = { tracks: [{ id: 't1', clips: [parentClip, slipped, aligned] }] };
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', startBeat: 1, pitch: 60 }]);

        propagateParentChanges('parent');

        expect(mocks.updateClipInStore).toHaveBeenCalledTimes(1);
        expect(mocks.updateClipInStore).toHaveBeenCalledWith('inst-1', expect.any(Function));
        const updater = mocks.updateClipInStore.mock.calls[0]![1];
        expect(updater({ id: 'inst-1' })).toMatchObject({ midiOffsetBeats: 2 });
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
