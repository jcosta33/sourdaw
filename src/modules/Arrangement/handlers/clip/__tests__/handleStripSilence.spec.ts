import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStripSilence } from '../handleStripSilence';

const mocks = vi.hoisted(() => ({
    stripSilence: vi.fn(),
    captureTrackClipStates: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../useCases/stripSilence', () => ({
    stripSilence: mocks.stripSilence,
}));

vi.mock('../../../useCases/captureTrackClipStates', () => ({
    captureTrackClipStates: mocks.captureTrackClipStates,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleStripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stripSilence.mockReturnValue(true);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'c1' });
    });

    describe('execute', () => {
        it('executes stripSilence with the provided payload', () => {
            const result = handleStripSilence.execute({
                type: 'stripSilence',
                payload: { clipId: 'c1', threshold: -30, minDuration: 0.1 },
            });

            expect(mocks.stripSilence).toHaveBeenCalledWith('c1', -30, 0.1);
            expect(result).toEqual({ status: 'written' });
        });

        it('returns no-write when strip silence is rejected', () => {
            mocks.stripSilence.mockReturnValue(false);

            const result = handleStripSilence.execute({
                type: 'stripSilence',
                payload: { clipId: 'vca-clip' },
            });

            expect(result).toEqual({ status: 'no-write' });
        });
    });

    describe('describe', () => {
        it('emits a null inverse action when the clip is ineligible', () => {
            mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

            const desc = handleStripSilence.describe({
                type: 'stripSilence',
                payload: { clipId: 'vca-clip' },
            });

            expect(desc.label).toBe('Strip silence');
            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('captures the pre-strip state for the clip"s owning track', () => {
            const preStripState = [
                { trackId: 't1', clips: [], midiNotesByClipId: {}, midiCcByClipId: {}, midiPitchBendByClipId: {} },
            ];
            mocks.captureTrackClipStates.mockReturnValue(preStripState);

            const desc = handleStripSilence.describe({
                type: 'stripSilence',
                payload: { clipId: 'c1' },
            });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(['t1']);
            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
                throw new Error('expected a restoreTrackClipStates inverse action');
            }
            expect(desc.inverseAction.payload.replacement).toBe(preStripState);
        });
    });

    it('round-trips: the inverse restores the ONE original clip that strip silence replaced with several', () => {
        const originalClip = { id: 'c1', trackId: 't1', startBeat: 0, endBeat: 8 };
        const preStripState = [
            {
                trackId: 't1',
                clips: [originalClip],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        const strippedClipOne = { id: 'clip-strip-1', trackId: 't1', startBeat: 0, endBeat: 3 };
        const strippedClipTwo = { id: 'clip-strip-2', trackId: 't1', startBeat: 5, endBeat: 8 };
        const postStripState = [
            {
                trackId: 't1',
                clips: [strippedClipOne, strippedClipTwo],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        mocks.captureTrackClipStates.mockReturnValueOnce(preStripState).mockReturnValueOnce(postStripState);

        const action = { type: 'stripSilence' as const, payload: { clipId: 'c1' } };
        const desc = handleStripSilence.describe(action);
        if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates inverse action');
        }
        if (!desc.redoAction || desc.redoAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates redo action');
        }

        const result = handleStripSilence.execute(action);

        expect(result).toEqual({ status: 'written' });
        // The operation replaced one clip with two; the inverse must carry the
        // ORIGINAL single clip back, not the strip-silence output.
        expect(desc.inverseAction.payload.replacement).toEqual(preStripState);
        expect(desc.inverseAction.payload.replacement[0]?.clips).toEqual([originalClip]);
        expect(desc.inverseAction.payload.expected).toEqual(postStripState);
        expect(desc.redoAction.payload.expected).toEqual(preStripState);
        expect(desc.redoAction.payload.replacement).toEqual(postStripState);
    });

    it('is undoable', () => {
        expect(handleStripSilence.undoable).toBe(true);
    });
});
