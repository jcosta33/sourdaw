import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveClip } from '../handleRemoveClip';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeClip: vi.fn(),
    planRippleDelete: vi.fn(),
    rippleDeleteClips: vi.fn(),
    midiStoreValue: { value: null } as any,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));

vi.mock('../../../useCases/rippleDelete/planRippleDelete', () => ({
    planRippleDelete: mocks.planRippleDelete,
}));

vi.mock('../../../useCases/rippleDelete/rippleDeleteClips', () => ({
    rippleDeleteClips: mocks.rippleDeleteClips,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

describe('handleRemoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.planRippleDelete.mockReturnValue(null);
        mocks.rippleDeleteClips.mockReturnValue(false);
    });

    describe('execute', () => {
        it('removes clip directly if track state is missing', () => {
            handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.rippleDeleteClips).not.toHaveBeenCalled();
        });

        it('removes clip directly if clip is not found in tracks', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });
            handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
        });

        it('attempts ripple delete and falls back to regular remove if ripple returns false', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [{ id: 'c1' }] }] });
            mocks.rippleDeleteClips.mockReturnValue(false);

            handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
        });

        it('attempts ripple delete and succeeds without falling back', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [{ id: 'c1' }] }] });
            mocks.rippleDeleteClips.mockReturnValue(true);

            handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns simple label if state or clip is missing', () => {
            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });
            expect(desc.label).toBe('Remove clip');
            expect((desc as any).inverseAction).toBeUndefined();
        });

        it('returns inverse action with full clip and MIDI snapshots', () => {
            const mockClip = { id: 'c1', name: 'Clip 1' };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [mockClip] }] });
            mocks.planRippleDelete.mockReturnValue({ removedClips: [], shiftedClips: [] });

            const mockMidiNotes = [{ id: 'n1', pitch: 60 }];
            mocks.midiStoreValue.value = {
                notesByClipId: { c1: mockMidiNotes },
                ccByClipId: {},
                pitchBendByClipId: {},
            };

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(desc.label).toBe('Remove clip');
            expect(desc.inverseAction).toBeDefined();
            expect(desc.inverseAction?.type).toBe('restoreClip');
            expect(desc.inverseAction?.payload).toMatchObject({
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: mockClip,
                ripplePlan: { removedClips: [], shiftedClips: [] },
                midiNotesSnapshot: mockMidiNotes,
                midiCcSnapshot: null,
                midiPitchBendSnapshot: null,
            });
        });
    });

    it('is undoable', () => {
        expect(handleRemoveClip.undoable).toBe(true);
    });
});
