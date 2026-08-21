import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleRestoreTrackClipStates } from '../handleRestoreTrackClipStates';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    updateTrack: vi.fn(),
    restoreMidiClipData: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

function snapshotFor(trackId: string, clipIds: readonly string[]): TrackClipStateSnapshot {
    return {
        trackId,
        clips: clipIds.map((id) => ClipDummy.create({ id, trackId })),
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
    };
}

describe('handleRestoreTrackClipStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('refuses and writes nothing when a named track is missing entirely', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        });

        it('refuses when a clip was added on the named track since capture', () => {
            const track = TrackDummy.create({
                id: 't1',
                clips: [ClipDummy.create({ id: 'c1' }), ClipDummy.create({ id: 'c2' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when a clip was removed on the named track since capture', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1', 'c2'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when the clip order on the named track has changed since capture', () => {
            const track = TrackDummy.create({
                id: 't1',
                clips: [ClipDummy.create({ id: 'c2' }), ClipDummy.create({ id: 'c1' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1', 'c2'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('writes nothing at all when only one of several named tracks diverges', () => {
            // Decisive test: a partial restore across the batch is exactly the lost
            // update this handler exists to prevent. t1 still matches; t2 does not.
            const trackOne = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            const trackTwo = TrackDummy.create({
                id: 't2',
                clips: [ClipDummy.create({ id: 'c2' }), ClipDummy.create({ id: 'c3' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1']), snapshotFor('t2', ['c2'])],
                    replacement: [snapshotFor('t1', []), snapshotFor('t2', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        });

        it('writes every replacement entry, clips and MIDI satellites, once the whole guard holds', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
            const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
            const cc = { id: 'cc-1', controller: 1, value: 10, beat: 0, channel: 0 };
            const pitchBend = { id: 'pb-1', value: 0, beat: 0, channel: 0 };
            const restoredClip = ClipDummy.create({ id: 'restored-c1' });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [
                        {
                            trackId: 't1',
                            clips: [restoredClip],
                            midiNotesByClipId: { 'restored-c1': [note] },
                            midiCcByClipId: { 'restored-c1': [cc] },
                            midiPitchBendByClipId: { 'restored-c1': [pitchBend] },
                        },
                    ],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
            const [calledTrackId, updater] = mocks.updateTrack.mock.calls[0]!;
            expect(calledTrackId).toBe('t1');
            expect(updater(track)).toEqual({ ...track, clips: [restoredClip] });
            expect(mocks.restoreMidiClipData).toHaveBeenCalledWith({
                clipId: 'restored-c1',
                notesSnapshot: [note],
                controlChangeSnapshot: [cc],
                pitchBendSnapshot: [pitchBend],
            });
        });

        it('writes every named track when the whole guard holds across several tracks', () => {
            const trackOne = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            const trackTwo = TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'c2' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1']), snapshotFor('t2', ['c2'])],
                    replacement: [snapshotFor('t1', []), snapshotFor('t2', [])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(2);
            expect(mocks.updateTrack.mock.calls.map((call) => call[0])).toEqual(['t1', 't2']);
        });
    });

    it('describes with a null inverse action — invoked only by undo/redo machinery', () => {
        const desc = handleRestoreTrackClipStates.describe({
            type: 'restoreTrackClipStates',
            payload: { expected: [], replacement: [] },
        });

        expect(desc.label).toBe('Restore clip state');
        expect(desc.inverseAction).toBeNull();
    });

    describe('isNoop', () => {
        it('is true when every replacement entry already matches live state', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const isNoop = handleRestoreTrackClipStates.isNoop?.({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(isNoop).toBe(true);
        });

        it('is false when a replacement entry does not match live state', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const isNoop = handleRestoreTrackClipStates.isNoop?.({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [],
                    replacement: [snapshotFor('t1', ['c1', 'c2'])],
                },
            });

            expect(isNoop).toBe(false);
        });
    });

    it('is not undoable — invoked only by undo/redo machinery', () => {
        expect(handleRestoreTrackClipStates.undoable).toBe(false);
    });
});
