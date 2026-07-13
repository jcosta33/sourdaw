import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';

import { handleRemoveClip } from '../handleRemoveClip';

type TestClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

type TestTrackState = {
    tracks: { id: string; clips: TestClip[] }[];
};

type RippleDeleteInput = {
    trackId: string;
    clipIds: string[];
};

type RippleDeleteResult = {
    removedClips: TestClip[];
    shiftedClips: { clipId: string; origStartBeat: number; origEndBeat: number }[];
};

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => TestTrackState | null>(),
    removeClip: vi.fn<(clipId: string) => void>(),
    planRippleDelete: vi.fn<(input: RippleDeleteInput) => RippleDeleteResult | null>(),
    rippleDeleteClips: vi.fn<(input: RippleDeleteInput) => RippleDeleteResult | null>(),
    getMidiStoreState: vi.fn<() => MidiStoreState | null>(),
    removeMidiClipData: vi.fn<(clipIds: readonly string[]) => void>(),
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

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiStoreState: mocks.getMidiStoreState,
    removeMidiClipData: mocks.removeMidiClipData,
}));

describe('handleRemoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.planRippleDelete.mockReturnValue(null);
        mocks.rippleDeleteClips.mockReturnValue(null);
        mocks.getMidiStoreState.mockReturnValue(null);
    });

    describe('execute', () => {
        it('removes clip directly if track state is missing', () => {
            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.rippleDeleteClips).not.toHaveBeenCalled();
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('removes clip directly if clip is not found in tracks', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('attempts ripple delete and falls back to regular remove if ripple returns null', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        clips: [{ id: 'c1', trackId: 't1', name: 'Clip 1', startBeat: 0, endBeat: 1 }],
                    },
                ],
            });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('cleans every ripple-removed clip in one MIDI owner call after the ripple mutation', () => {
            const removedClips: TestClip[] = [
                { id: 'c1', trackId: 't1', name: 'Clip 1', startBeat: 0, endBeat: 1 },
                { id: 'c2', trackId: 't1', name: 'Clip 2', startBeat: 1, endBeat: 2 },
            ];
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [removedClips[0]] }] });
            mocks.rippleDeleteClips.mockReturnValue({ removedClips, shiftedClips: [] });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).not.toHaveBeenCalled();
            expect(mocks.removeMidiClipData).toHaveBeenCalledTimes(1);
            expect(mocks.removeMidiClipData).toHaveBeenCalledWith(['c1', 'c2']);

            const rippleMutationOrder = mocks.rippleDeleteClips.mock.invocationCallOrder[0] ?? 0;
            const midiCleanupOrder = mocks.removeMidiClipData.mock.invocationCallOrder[0] ?? 0;
            expect(rippleMutationOrder).toBeLessThan(midiCleanupOrder);
        });
    });

    describe('describe', () => {
        it('returns simple label if state or clip is missing', () => {
            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });
            expect(desc).toEqual({ label: 'Remove clip' });
        });

        it('returns inverse action with full clip and MIDI snapshots', () => {
            const mockClip: TestClip = { id: 'c1', trackId: 't1', name: 'Clip 1', startBeat: 0, endBeat: 1 };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [mockClip] }] });
            mocks.planRippleDelete.mockReturnValue({ removedClips: [], shiftedClips: [] });

            const mockMidiNotes = [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
            mocks.getMidiStoreState.mockReturnValue({
                notesByClipId: { c1: mockMidiNotes },
                ccByClipId: {},
                pitchBendByClipId: {},
            });

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(desc.label).toBe('Remove clip');
            expect(mocks.getMidiStoreState).toHaveBeenCalledTimes(1);
            expect(desc.inverseAction).toMatchObject({
                type: 'restoreClip',
                payload: {
                    clipId: 'c1',
                    trackId: 't1',
                    clipSnapshot: mockClip,
                    ripplePlan: { removedClips: [], shiftedClips: [] },
                    midiNotesSnapshot: mockMidiNotes,
                    midiCcSnapshot: null,
                    midiPitchBendSnapshot: null,
                },
            });

            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreClip') {
                throw new Error('Expected a restoreClip inverse action');
            }

            expect(desc.inverseAction.payload).toMatchObject({
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: mockClip,
                ripplePlan: { removedClips: [], shiftedClips: [] },
                midiNotesSnapshot: mockMidiNotes,
                midiCcSnapshot: null,
                midiPitchBendSnapshot: null,
            });
            expect(desc.inverseAction.payload.clipSnapshot).not.toBe(mockClip);
            expect(desc.inverseAction.payload.midiNotesSnapshot).not.toBe(mockMidiNotes);
        });
    });

    it('is undoable', () => {
        expect(handleRemoveClip.undoable).toBe(true);
    });
});
