import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    pushUndoEntry: vi.fn(),
    removeMidiClipData: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    // Captured from the real barrel at mock-factory time so the behavioral
    // test can drive deleteTimeRange through the genuine partition without
    // a per-test importActual (and without any deep cross-module edge).
    actualSplitMidiNotesAtBeat: { fn: undefined as unknown },
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mocks.pushUndoEntry }));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    mocks.actualSplitMidiNotesAtBeat.fn = actual.splitMidiNotesAtBeat;
    return {
        removeMidiClipData: mocks.removeMidiClipData,
        splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
    };
});

import { midiStore } from '#/modules/MIDI/stores';

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
                            // Right clip's MIDI media starts at the split —
                            // its notes are re-based by splitMidiNotesAtBeat.
                            midiOffsetBeats: 0,
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
        // The right clip starts at the hole END (timeline 7, media 7 for a
        // clip at 0); the hole's media window [3, 7) is discarded, not kept.
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'span-midi',
            newClipId: 'clip-dtr-12345678',
            splitBeat: 7,
            discardBeforeBeat: 3,
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
    /// Regression (PR #608 review, blocking): end-to-end note positions for
    /// a spanning MIDI clip — hole notes must be gone, post-hole notes must
    /// land at their original timeline positions on the right clip.
    it('deletes hole notes and keeps post-hole notes at their timeline positions (real partition)', async () => {
        mocks.splitMidiNotesAtBeat.mockImplementation(
            mocks.actualSplitMidiNotesAtBeat.fn as (...args: unknown[]) => void
        );

        const state = {
            tracks: [
                {
                    id: 'target',
                    clips: [{ id: 'span-midi', type: 'midi', name: 'Span', startBeat: 0, endBeat: 10 }],
                },
            ],
            selectedTrackId: 'target',
        };
        mocks.getTrackState.mockReturnValue(state);
        midiStore.set({
            notesByClipId: {
                'span-midi': [
                    { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'n-straddle', pitch: 62, startBeat: 2, duration: 3, velocity: 100 }, // [2,5) — trimmed to [2,3)
                    { id: 'n-hole', pitch: 64, startBeat: 4, duration: 1, velocity: 100 }, // [4,5) — deleted
                    { id: 'n-spanner', pitch: 65, startBeat: 1.5, duration: 7, velocity: 100 }, // [1.5,8.5) — stubs both sides
                    { id: 'n-post', pitch: 67, startBeat: 8, duration: 1, velocity: 100 }, // [8,9) — re-based to 1
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        deleteTimeRange(3, 7, ['target']);

        const notes = midiStore.value?.notesByClipId ?? {};
        // Left clip [0,3): left note untouched, hole-start straddlers trimmed
        // to the hole start.
        expect(notes['span-midi']).toEqual([
            { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
            { id: 'n-straddle', pitch: 62, startBeat: 2, duration: 1, velocity: 100 },
            { id: 'n-spanner', pitch: 65, startBeat: 1.5, duration: 1.5, velocity: 100 },
        ]);
        // Right clip [7,10): hole note is gone; the hole-spanner's remainder
        // starts at 0 (plays at 7) and the post-hole note sits at 1 (plays
        // at 8 — its original timeline position).
        const right = notes['clip-dtr-12345678'] ?? [];
        expect(right).toHaveLength(2);
        expect(right[0]).toMatchObject({ startBeat: 0, duration: 1.5, pitch: 65 });
        expect(right[1]).toMatchObject({ id: 'n-post', startBeat: 1, duration: 1 });
        expect(right.some((note) => note.id === 'n-hole')).toBe(false);
        expect(notes['span-midi']?.some((note) => note.id === 'n-hole')).toBe(false);
    });
});
