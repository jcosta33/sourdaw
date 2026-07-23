import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteTime } from '../deleteTime';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    markerStoreSet: vi.fn(),
    deleteAutomationTimeRange: vi.fn(),
    deleteTimelineMapsTimeRange: vi.fn(),
    removeMidiClipData: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    markerStoreValue: { markers: [] as unknown[], sections: [] as unknown[] },
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue;
        },
        set: mocks.markerStoreSet,
    },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    deleteAutomationTimeRange: mocks.deleteAutomationTimeRange,
}));
vi.mock('#/modules/Transport/useCases', () => ({
    deleteTimelineMapsTimeRange: mocks.deleteTimelineMapsTimeRange,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    removeMidiClipData: mocks.removeMidiClipData,
    splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
}));

describe('deleteTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.markerStoreValue = { markers: [], sections: [] };
        setTimeOperationDependencies({
            shiftTimelineMapsAfterBeat: vi.fn(),
            deleteTimelineMapsTimeRange: mocks.deleteTimelineMapsTimeRange,
        });
    });

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(() => deleteTime(0, 4)).not.toThrow();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.deleteAutomationTimeRange).not.toHaveBeenCalled();
        expect(mocks.deleteTimelineMapsTimeRange).not.toHaveBeenCalled();
    });

    it('throws before writing when dependencies are not registered', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });
        setTimeOperationDependencies(null);

        expect(() => deleteTime(0, 4)).toThrow('Arrangement time operation dependencies are not registered');
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
        expect(mocks.deleteAutomationTimeRange).not.toHaveBeenCalled();
        expect(mocks.deleteTimelineMapsTimeRange).not.toHaveBeenCalled();
    });

    it('processes time deletion with empty tracks', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });
        expect(() => deleteTime(0, 4)).not.toThrow();
    });

    it('processes time deletion with tracks and clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 4, endBeat: 8 },
                    ],
                },
            ],
            selectedTrackId: 't1',
        });
        deleteTime(2, 6);

        // Right-edge-crossing clip: kept part lands at the range start with
        // its audio content re-based and a fresh id (its MIDI media starts
        // at the split point) — the previous pin asserted the old geometry,
        // which replayed the wrong media (ledger M-022).
        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        expect.objectContaining({
                            id: expect.stringMatching(/^clip-dt-/),
                            startBeat: 2,
                            endBeat: 4,
                            audioOffsetBeats: 2,
                            midiOffsetBeats: 0,
                        }),
                    ],
                },
            ],
            selectedTrackId: 't1',
        });
        expect(mocks.deleteAutomationTimeRange).toHaveBeenCalledWith({ startBeat: 2, endBeat: 6 });
        expect(mocks.deleteTimelineMapsTimeRange).toHaveBeenCalledWith({ startBeat: 2, endBeat: 6 });
    });

    it('cleans MIDI data of fully-inside clips (regression: ledger M-022)', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'inside', startBeat: 2, endBeat: 4, type: 'midi' },
                        { id: 'after', startBeat: 8, endBeat: 10, type: 'midi' },
                    ],
                },
            ],
            selectedTrackId: 't1',
        });
        deleteTime(2, 6);

        expect(mocks.removeMidiClipData).toHaveBeenCalledWith(['inside']);
        // The clip after the range shifts left; its clip-relative notes
        // follow without any note-level work.
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('splits a spanning MIDI clip at the range with hole notes discarded (regression: ledger M-022)', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'span', startBeat: 0, endBeat: 10, type: 'midi' }],
                },
            ],
            selectedTrackId: 't1',
        });
        deleteTime(2, 6);

        const written = mocks.setTrackState.mock.calls[0]?.[0] as {
            tracks: Array<{ clips: Array<{ id: string; startBeat: number; endBeat: number }> }>;
        };
        const clips = written.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        expect(clips[0]).toMatchObject({ id: 'span', startBeat: 0, endBeat: 2 });
        expect(clips[1]).toMatchObject({ startBeat: 2, endBeat: 6 });
        expect(clips[1]!.id).not.toBe('span');

        // Media-beat partition: hole [2,6) media beats discarded, right
        // notes re-based onto the new clip (deleteTimeRange convention, #608).
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceClipId: 'span',
                newClipId: clips[1]!.id,
                splitBeat: 6,
                discardBeforeBeat: 2,
            })
        );
    });

    it('drops sections inside the range and shifts later sections left (regression: ledger M-022)', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: 't1' });
        deleteTime(2, 6);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                sections: [],
            })
        );
    });

    it('trims straddling sections instead of deleting them (PR #621 review)', () => {
        mocks.markerStoreValue = {
            markers: [],
            sections: [
                { id: 'before', startBeat: 0, endBeat: 1, name: 'Before', color: '' },
                { id: 'inside', startBeat: 3, endBeat: 5, name: 'Inside', color: '' },
                { id: 'left-cross', startBeat: 1, endBeat: 4, name: 'LeftCross', color: '' },
                { id: 'right-cross', startBeat: 4, endBeat: 9, name: 'RightCross', color: '' },
                { id: 'span', startBeat: 0, endBeat: 10, name: 'Span', color: '' },
                { id: 'after', startBeat: 8, endBeat: 12, name: 'After', color: '' },
            ],
        };
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: 't1' });
        deleteTime(2, 6);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                sections: [
                    { id: 'before', startBeat: 0, endBeat: 1, name: 'Before', color: '' },
                    { id: 'left-cross', startBeat: 1, endBeat: 2, name: 'LeftCross', color: '' },
                    { id: 'right-cross', startBeat: 2, endBeat: 5, name: 'RightCross', color: '' },
                    { id: 'span', startBeat: 0, endBeat: 2, name: 'Span (L)', color: '' },
                    { id: 'span', startBeat: 2, endBeat: 6, name: 'Span (R)', color: '' },
                    { id: 'after', startBeat: 4, endBeat: 8, name: 'After', color: '' },
                ],
            })
        );
    });

    it('handles zero-length deletion', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });
        deleteTime(4, 4);
        expect(mocks.deleteAutomationTimeRange).toHaveBeenCalledWith({ startBeat: 4, endBeat: 4 });
        expect(mocks.deleteTimelineMapsTimeRange).toHaveBeenCalledWith({ startBeat: 4, endBeat: 4 });
    });
});
