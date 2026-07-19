import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    pushUndoEntry: vi.fn(),
    removeMidiClipData: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mocks.pushUndoEntry }));
vi.mock('#/modules/MIDI/useCases', () => ({
    removeMidiClipData: mocks.removeMidiClipData,
    splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
}));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { deleteTimeRange } from '../deleteTimeRange';

describe('deleteTimeRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4123-8123-123456789abc');
    });

    it('removes clips, splits spanning MIDI clips, and delegates MIDI cleanup after the track write', () => {
        const state = {
            tracks: [
                {
                    id: 'target',
                    clips: [
                        { id: 'drop-midi', type: 'midi', name: 'Drop', startBeat: 4, endBeat: 5 },
                        { id: 'span-midi', type: 'midi', name: 'Span', startBeat: 0, endBeat: 10 },
                        { id: 'untouched', type: 'audio', name: 'Untouched', startBeat: 12, endBeat: 14 },
                    ],
                },
                {
                    id: 'other',
                    clips: [{ id: 'other-clip', type: 'audio', name: 'Other', startBeat: 2, endBeat: 4 }],
                },
            ],
            selectedTrackId: 'target',
        };
        mocks.getTrackState.mockReturnValue(state);

        deleteTimeRange(3, 7, ['target']);

        const nextState = {
            tracks: [
                {
                    id: 'target',
                    clips: [
                        { id: 'span-midi', type: 'midi', name: 'Span (L)', startBeat: 0, endBeat: 3 },
                        {
                            id: 'clip-dtr-12345678',
                            type: 'midi',
                            name: 'Span (R)',
                            startBeat: 7,
                            endBeat: 10,
                            audioOffsetBeats: 7,
                        },
                        { id: 'untouched', type: 'audio', name: 'Untouched', startBeat: 12, endBeat: 14 },
                    ],
                },
                {
                    id: 'other',
                    clips: [{ id: 'other-clip', type: 'audio', name: 'Other', startBeat: 2, endBeat: 4 }],
                },
            ],
            selectedTrackId: 'target',
        };

        expect(mocks.setTrackState).toHaveBeenCalledWith(nextState);
        expect(mocks.removeMidiClipData).toHaveBeenCalledWith(['drop-midi']);
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'span-midi',
            newClipId: 'clip-dtr-12345678',
            splitBeat: 3,
        });
        expect(mocks.setTrackState.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeMidiClipData.mock.invocationCallOrder[0]!
        );
        expect(mocks.removeMidiClipData.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.splitMidiNotesAtBeat.mock.invocationCallOrder[0]!
        );
    });

    it('does nothing when arrangement state is unavailable', () => {
        mocks.getTrackState.mockReturnValue(null);

        deleteTimeRange(0, 4, ['target']);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('trims partial overlaps on either side of the range without touching MIDI data', () => {
        const left = ClipDummy.create({ id: 'left', startBeat: 2, endBeat: 6 });
        const right = ClipDummy.create({ id: 'right', startBeat: 6, endBeat: 10, audioOffsetBeats: 1 });
        const track = TrackDummy.create({ id: 'target', clips: [left, right] });
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 'target' });

        deleteTimeRange(4, 8, ['target']);

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    ...track,
                    clips: [
                        { ...left, endBeat: 4 },
                        { ...right, startBeat: 8, audioOffsetBeats: 3 },
                    ],
                },
            ],
            selectedTrackId: 'target',
        });
        expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('pushes an undo entry that restores the original tracks and a redo that re-applies the deletion', () => {
        const doomed = ClipDummy.create({ id: 'doomed', startBeat: 1, endBeat: 3 });
        const track = TrackDummy.create({ id: 'target', clips: [doomed] });
        const originalTracks = [track];
        mocks.getTrackState.mockReturnValue({ tracks: originalTracks, selectedTrackId: 'target' });

        deleteTimeRange(0, 4, ['target']);

        expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
            'Delete Time Range',
            expect.any(Function),
            expect.any(Function)
        );
        const [, undoFn, redoFn] = mocks.pushUndoEntry.mock.calls[0]!;

        mocks.setTrackState.mockClear();
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: 'later' });
        undoFn();
        expect(mocks.setTrackState).toHaveBeenCalledWith({ tracks: originalTracks, selectedTrackId: 'later' });

        mocks.setTrackState.mockClear();
        redoFn();
        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [{ ...track, clips: [] }],
            selectedTrackId: 'later',
        });
    });
});
