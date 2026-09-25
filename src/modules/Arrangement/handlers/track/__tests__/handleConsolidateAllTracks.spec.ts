import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleConsolidateAllTracks } from '../handleConsolidateAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    bounceInPlace: vi.fn(),
    captureTrackClipStates: vi.fn(),
    removeTakesForClips: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/freezeBounce/bounceInPlace', () => ({
    bounceInPlace: mocks.bounceInPlace,
}));

vi.mock('../../../useCases/captureTrackClipStates', () => ({
    captureTrackClipStates: mocks.captureTrackClipStates,
}));

vi.mock('../../../useCases/comping/removeTakesForClips', () => ({
    removeTakesForClips: mocks.removeTakesForClips,
}));

const mixedTracks = () => [
    TrackDummy.create({ id: 't1', kind: 'audio', clips: [ClipDummy.create()] }),
    TrackDummy.create({ id: 't2', kind: 'midi', clips: [ClipDummy.create()] }),
    TrackDummy.create({ id: 't3', kind: 'audio', clips: [] }), // no clips, excluded
    TrackDummy.create({ id: 't4', kind: 'bus', clips: [ClipDummy.create()] }), // wrong kind, excluded
];

describe('handleConsolidateAllTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bounceInPlace.mockResolvedValue(true);
        mocks.captureTrackClipStates.mockReturnValue([]);
    });

    describe('execute', () => {
        it('returns no-write and bounces nothing when track store state is unavailable', async () => {
            mocks.getTrackStoreState.mockReturnValue(null);

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(mocks.bounceInPlace).not.toHaveBeenCalled();
            expect(result).toEqual({ status: 'no-write' });
        });

        it('bounces audio and midi tracks that have clips, skipping ineligible ones', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(mocks.bounceInPlace).toHaveBeenCalledTimes(2);
            // `recordUndoEntry: false` on every nested bounce: this command owns one
            // atomic undo unit, and a nested callback entry underneath it would hold a
            // part-way-through-the-loop snapshot that undoing past this command replays.
            // `transactionScope` re-enters that unit's storage transaction, because
            // every bounce after the first runs past the `await` that dropped it.
            expect(mocks.bounceInPlace).toHaveBeenNthCalledWith(1, 't1', {
                recordUndoEntry: false,
                transactionScope: expect.any(Function),
            });
            expect(mocks.bounceInPlace).toHaveBeenNthCalledWith(2, 't2', {
                recordUndoEntry: false,
                transactionScope: expect.any(Function),
            });
            expect(result).toEqual({ status: 'written' });
        });

        it('returns no-write when no track matches the predicate', async () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({ id: 't3', kind: 'audio', clips: [] }),
                    TrackDummy.create({ id: 't4', kind: 'bus', clips: [ClipDummy.create()] }),
                ],
            });

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(mocks.bounceInPlace).not.toHaveBeenCalled();
            expect(result).toEqual({ status: 'no-write' });
        });

        // A refused bounce (an unrenderable device on the track, see
        // `buildDeviceChain`'s plugin refusal) resolves `false`. A loop where
        // every eligible track refused wrote nothing, so filing `written`
        // would leave an inert undo entry with no change behind it.
        it('returns no-write when every bounce in the loop refuses', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });
            mocks.bounceInPlace.mockResolvedValue(false);

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(mocks.bounceInPlace).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ status: 'no-write' });
        });

        // A partial write is still a write: one bounced track changed real
        // clips, so the undo unit this command files has content to restore.
        it('returns written when at least one bounce in the loop writes', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });
            mocks.bounceInPlace.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(mocks.bounceInPlace).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ status: 'written' });
        });
    });

    describe('describe', () => {
        it('provides a description', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });
            const desc = handleConsolidateAllTracks.describe({ type: 'consolidateAllTracks', payload: undefined });
            expect(desc.label).toBe('Consolidate all tracks');
        });

        it('emits a null inverse and captures nothing when no track matches the predicate', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleConsolidateAllTracks.describe({ type: 'consolidateAllTracks', payload: undefined });

            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('captures the pre-consolidate state for exactly the eligible tracks, as one inverse', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });
            const preConsolidateState = [
                { trackId: 't1', clips: [], midiNotesByClipId: {}, midiCcByClipId: {}, midiPitchBendByClipId: {} },
                { trackId: 't2', clips: [], midiNotesByClipId: {}, midiCcByClipId: {}, midiPitchBendByClipId: {} },
            ];
            mocks.captureTrackClipStates.mockReturnValue(preConsolidateState);

            const desc = handleConsolidateAllTracks.describe({ type: 'consolidateAllTracks', payload: undefined });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(['t1', 't2'], expect.any(Array));
            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
                throw new Error('expected a restoreTrackClipStates inverse action');
            }
            expect(desc.inverseAction.payload.replacement).toBe(preConsolidateState);
            expect(desc.inverseAction.payload.expected).toEqual([]);
            // Ineligible tracks never enter the undo unit.
            const coveredTrackIds = desc.inverseAction.payload.replacement.map((entry) => entry.trackId);
            expect(coveredTrackIds).not.toContain('t3');
            expect(coveredTrackIds).not.toContain('t4');
        });
    });

    it('round-trips: one inverse restores the pre-consolidate clips for every eligible track, and redo re-applies the post-consolidate collections', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });
        const preConsolidateState = [
            {
                trackId: 't1',
                clips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
            {
                trackId: 't2',
                clips: [{ id: 'c2', trackId: 't2', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        const postConsolidateState = [
            {
                trackId: 't1',
                clips: [{ id: 'bounced-t1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
            {
                trackId: 't2',
                clips: [{ id: 'bounced-t2', trackId: 't2', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        mocks.captureTrackClipStates.mockReturnValueOnce(preConsolidateState).mockReturnValueOnce(postConsolidateState);

        const action = { type: 'consolidateAllTracks' as const, payload: undefined };
        const desc = handleConsolidateAllTracks.describe(action);
        if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates inverse action');
        }
        if (!desc.redoAction || desc.redoAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates redo action');
        }

        expect(desc.inverseAction.payload.expected).toEqual([]);
        expect(desc.redoAction.payload.replacement).toEqual([]);

        const result = await handleConsolidateAllTracks.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(mocks.bounceInPlace).toHaveBeenCalledTimes(2);
        expect(mocks.captureTrackClipStates).toHaveBeenLastCalledWith(['t1', 't2']);
        expect(desc.inverseAction.payload.expected).toEqual(postConsolidateState);
        expect(desc.inverseAction.payload.replacement).toEqual(preConsolidateState);
        expect(desc.redoAction.payload.expected).toEqual(preConsolidateState);
        expect(desc.redoAction.payload.replacement).toEqual(postConsolidateState);
    });

    it('describe-time and execute-time predicates select the exact same eligible tracks', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });

        const action = { type: 'consolidateAllTracks' as const, payload: undefined };
        handleConsolidateAllTracks.describe(action);
        const [describeCallArgs] = mocks.captureTrackClipStates.mock.calls;

        await handleConsolidateAllTracks.execute(action);
        const executeTimeTrackIds = mocks.bounceInPlace.mock.calls.map((call) => call[0]);

        expect(describeCallArgs![0]).toEqual(['t1', 't2']);
        expect(executeTimeTrackIds).toEqual(['t1', 't2']);
    });

    describe('take retirement (#4518)', () => {
        const takeTracks = () => [
            TrackDummy.create({
                id: 't1',
                kind: 'audio',
                clips: [ClipDummy.create({ id: 't1-clip', trackId: 't1' })],
                alternatives: [
                    {
                        id: 'alt-1',
                        name: 'Alternative 1',
                        clips: [ClipDummy.create({ id: 't1-hidden', trackId: 't1' })],
                    },
                ],
            }),
            TrackDummy.create({ id: 't2', kind: 'midi', clips: [ClipDummy.create({ id: 't2-clip', trackId: 't2' })] }),
        ];

        it('retires the takes of every replaced clip — including hidden alternatives — after the bounces land', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: takeTracks() });

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.removeTakesForClips).toHaveBeenCalledTimes(1);
            expect(mocks.removeTakesForClips).toHaveBeenCalledWith(
                expect.arrayContaining(['t1-clip', 't1-hidden', 't2-clip'])
            );
        });

        it('retires nothing for a track whose bounce refused — its clips stayed, so its takes are still live', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: takeTracks() });
            mocks.bounceInPlace.mockImplementation((trackId: string) => Promise.resolve(trackId === 't1'));

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.removeTakesForClips).toHaveBeenCalledTimes(1);
            const [retiredIds] = mocks.removeTakesForClips.mock.calls[0]!;
            expect(retiredIds).toEqual(expect.arrayContaining(['t1-clip', 't1-hidden']));
            expect(retiredIds).not.toContain('t2-clip');
        });

        it('retires nothing when every bounce refuses', async () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: takeTracks() });
            mocks.bounceInPlace.mockResolvedValue(false);

            const result = await handleConsolidateAllTracks.execute({
                type: 'consolidateAllTracks',
                payload: undefined,
            });

            expect(result).toEqual({ status: 'no-write' });
            expect(mocks.removeTakesForClips).toHaveBeenCalledTimes(1);
            expect(mocks.removeTakesForClips).toHaveBeenCalledWith([]);
        });

        it('names the replaced clip ids in the pre-consolidate capture so the inverse can restore the retired lanes', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: takeTracks() });

            handleConsolidateAllTracks.describe({ type: 'consolidateAllTracks', payload: undefined });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(
                ['t1', 't2'],
                expect.arrayContaining(['t1-clip', 't1-hidden', 't2-clip'])
            );
        });
    });

    describe('isNoop', () => {
        it('is true on a project with no eligible track', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({ id: 't3', kind: 'audio', clips: [] }),
                    TrackDummy.create({ id: 't4', kind: 'bus', clips: [ClipDummy.create()] }),
                ],
            });

            expect(handleConsolidateAllTracks.isNoop?.({ type: 'consolidateAllTracks', payload: undefined })).toBe(
                true
            );
        });

        it('is false when at least one track matches the predicate', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: mixedTracks() });

            expect(handleConsolidateAllTracks.isNoop?.({ type: 'consolidateAllTracks', payload: undefined })).toBe(
                false
            );
        });
    });

    it('is undoable', () => {
        expect(handleConsolidateAllTracks.undoable).toBe(true);
    });
});
