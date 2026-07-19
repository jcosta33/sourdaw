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
vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
    runLegacyCommandMutation: (mutation: (commitUndo: typeof mocks.pushUndoEntry) => unknown) =>
        Promise.resolve(mutation(mocks.pushUndoEntry)),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    removeMidiClipData: mocks.removeMidiClipData,
    splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
}));

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
});
