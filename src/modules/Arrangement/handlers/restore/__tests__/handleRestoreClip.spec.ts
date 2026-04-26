import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreClip } from '../handleRestoreClip';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    undoRippleDelete: vi.fn(),
    midiStoreValue: { value: null } as any,
    midiStoreSet: vi.fn(),
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../useCases/rippleDelete/undoRippleDelete', () => ({
    undoRippleDelete: mocks.undoRippleDelete,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('handleRestoreClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = null;
    });

    it('restores clip using undoRippleDelete if ripplePlan is present', () => {
        void handleRestoreClip.execute({
            type: 'restoreClip',
            payload: {
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: {},
                ripplePlan: { removedClips: [{ id: 'c1' }], shiftedClips: [] },
                midiNotesSnapshot: null,
                midiCcSnapshot: null,
                midiPitchBendSnapshot: null,
            },
        });

        expect(mocks.undoRippleDelete).toHaveBeenCalledWith({
            trackId: 't1',
            removedClips: [{ id: 'c1' }],
            shiftedClips: [],
        });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('restores clip using updateTrack if ripplePlan is not present', () => {
        mocks.updateTrack.mockImplementation((id: any, updater: any) => {
            updater({ clips: [] });
        });

        void handleRestoreClip.execute({
            type: 'restoreClip',
            payload: {
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: { id: 'c1' },
                ripplePlan: null,
                midiNotesSnapshot: null,
                midiCcSnapshot: null,
                midiPitchBendSnapshot: null,
            },
        });

        expect(mocks.updateTrack).toHaveBeenCalled();
        expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
    });

    it('restores midi store data if snapshots are present', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        void handleRestoreClip.execute({
            type: 'restoreClip',
            payload: {
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: {},
                ripplePlan: null,
                midiNotesSnapshot: [{ pitch: 60 }],
                midiCcSnapshot: [{ value: 1 }],
                midiPitchBendSnapshot: [{ value: 0.5 }],
            },
        });

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const args = mocks.midiStoreSet.mock.calls[0][0];
        expect(args.notesByClipId.c1).toEqual([{ pitch: 60 }]);
        expect(args.ccByClipId.c1).toEqual([{ value: 1 }]);
        expect(args.pitchBendByClipId.c1).toEqual([{ value: 0.5 }]);
    });

    it('provides a description', () => {
        const desc = handleRestoreClip.describe({ type: 'restoreClip', payload: {} as any });
        expect(desc.label).toBe('Restore clip');
    });

    it('is not undoable', () => {
        expect(handleRestoreClip.undoable).toBe(false);
    });
});
