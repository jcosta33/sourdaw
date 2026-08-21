import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleFlattenTrack } from '../flattenTrack';

const mocks = vi.hoisted(() => ({
    flattenTrack: vi.fn(),
    captureTrackClipStates: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/flattenTrack', () => ({
    flattenTrack: mocks.flattenTrack,
}));

vi.mock('../../../useCases/captureTrackClipStates', () => ({
    captureTrackClipStates: mocks.captureTrackClipStates,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function frozenTrack(overrides?: Parameters<typeof TrackDummy.create>[0]) {
    return TrackDummy.create({
        id: 't1',
        freezeState: { status: 'frozen', freezeId: 'freeze-1', frozenBufferId: 'buffer-1' },
        ...overrides,
    });
}

describe('handleFlattenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flattenTrack.mockReturnValue(true);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [frozenTrack()] });
        mocks.captureTrackClipStates.mockReturnValue([]);
    });

    describe('execute', () => {
        it('executes flattenTrack with the provided payload', () => {
            const result = handleFlattenTrack.execute({ type: 'flattenTrack', payload: { trackId: 't1' } });

            expect(mocks.flattenTrack).toHaveBeenCalledWith('t1');
            expect(result).toEqual({ status: 'written' });
        });

        it('returns no-write when flattening is rejected', () => {
            mocks.flattenTrack.mockReturnValue(false);

            const result = handleFlattenTrack.execute({ type: 'flattenTrack', payload: { trackId: 'vca-1' } });

            expect(result).toEqual({ status: 'no-write' });
        });
    });

    describe('describe', () => {
        it('provides a description', () => {
            const desc = handleFlattenTrack.describe({ type: 'flattenTrack', payload: { trackId: 't1' } });
            expect(desc.label).toBe('Flatten track');
        });

        it('emits a null inverse and captures nothing when the write target is not eligible', () => {
            mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

            const desc = handleFlattenTrack.describe({ type: 'flattenTrack', payload: { trackId: 't1' } });

            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('emits a null inverse and captures nothing when the track is not frozen', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [TrackDummy.create({ id: 't1', freezeState: { status: 'unfrozen' } })],
            });

            const desc = handleFlattenTrack.describe({ type: 'flattenTrack', payload: { trackId: 't1' } });

            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('captures the pre-flatten clip state as the inverse replacement, with an empty placeholder expected', () => {
            const preFlattenState = [
                {
                    trackId: 't1',
                    clips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                    midiNotesByClipId: {},
                    midiCcByClipId: {},
                    midiPitchBendByClipId: {},
                },
            ];
            mocks.captureTrackClipStates.mockReturnValue(preFlattenState);

            const desc = handleFlattenTrack.describe({ type: 'flattenTrack', payload: { trackId: 't1' } });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(['t1']);
            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
                throw new Error('expected a restoreTrackClipStates inverse action');
            }
            expect(desc.inverseAction.payload.replacement).toBe(preFlattenState);
            expect(desc.inverseAction.payload.expected).toEqual([]);
        });
    });

    it('no inverse and { status: "no-write" } when the flatten refuses', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [TrackDummy.create({ id: 't1', freezeState: { status: 'unfrozen' } })],
        });
        mocks.flattenTrack.mockReturnValue(false);

        const action = { type: 'flattenTrack' as const, payload: { trackId: 't1' } };
        const desc = handleFlattenTrack.describe(action);
        const result = handleFlattenTrack.execute(action);

        expect(desc.inverseAction).toBeNull();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('round-trips: the inverse carries the pre-flatten clips, and redo carries the post-flatten clips', () => {
        const preFlattenState = [
            {
                trackId: 't1',
                clips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        const postFlattenState = [
            {
                trackId: 't1',
                clips: [{ id: 'flattened-c1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        mocks.captureTrackClipStates.mockReturnValueOnce(preFlattenState).mockReturnValueOnce(postFlattenState);

        const action = { type: 'flattenTrack' as const, payload: { trackId: 't1' } };
        const desc = handleFlattenTrack.describe(action);
        if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates inverse action');
        }
        if (!desc.redoAction || desc.redoAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates redo action');
        }

        // Before execute(), the post-flatten side is still an empty placeholder.
        expect(desc.inverseAction.payload.expected).toEqual([]);
        expect(desc.redoAction.payload.replacement).toEqual([]);

        const result = handleFlattenTrack.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(mocks.captureTrackClipStates).toHaveBeenLastCalledWith(['t1']);
        // Same action -> same referenced arrays -> execute() mutating them is
        // visible through the already-emitted describe() result.
        expect(desc.inverseAction.payload.expected).toEqual(postFlattenState);
        expect(desc.inverseAction.payload.replacement).toEqual(preFlattenState);
        expect(desc.redoAction.payload.expected).toEqual(preFlattenState);
        expect(desc.redoAction.payload.replacement).toEqual(postFlattenState);
    });

    describe('isNoop', () => {
        it('is false when the track is an eligible write target and frozen with a buffer', () => {
            const isNoop = handleFlattenTrack.isNoop?.({ type: 'flattenTrack', payload: { trackId: 't1' } });
            expect(isNoop).toBe(false);
        });

        it('is true when the write target is not eligible', () => {
            mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'missing' });
            const isNoop = handleFlattenTrack.isNoop?.({ type: 'flattenTrack', payload: { trackId: 't1' } });
            expect(isNoop).toBe(true);
        });

        it('is true when the track is not frozen', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [TrackDummy.create({ id: 't1', freezeState: { status: 'unfrozen' } })],
            });
            const isNoop = handleFlattenTrack.isNoop?.({ type: 'flattenTrack', payload: { trackId: 't1' } });
            expect(isNoop).toBe(true);
        });

        it('is true when frozen but no frozen buffer id is recorded', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [TrackDummy.create({ id: 't1', freezeState: { status: 'frozen' } })],
            });
            const isNoop = handleFlattenTrack.isNoop?.({ type: 'flattenTrack', payload: { trackId: 't1' } });
            expect(isNoop).toBe(true);
        });
    });

    it('is undoable', () => {
        expect(handleFlattenTrack.undoable).toBe(true);
    });
});
