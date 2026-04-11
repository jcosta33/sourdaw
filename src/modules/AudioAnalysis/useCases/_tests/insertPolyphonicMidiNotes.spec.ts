import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertPolyphonicMidiNotes } from '../insertPolyphonicMidiNotes';

const getTransportStateMock = vi.fn().mockReturnValue({ tempo: 120 });
const getAllTracksMock = vi.fn().mockReturnValue([]);
const addTrackMock = vi.fn().mockReturnValue(null);
const addClipMock = vi.fn();
const batchAddMidiNotesMock = vi.fn();

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: (...args: any[]) => getAllTracksMock(...args),
    addTrack: (...args: any[]) => addTrackMock(...args),
    addClip: (...args: any[]) => addClipMock(...args),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    batchAddMidiNotes: (...args: any[]) => batchAddMidiNotesMock(...args),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: (...args: any[]) => getTransportStateMock(...args),
}));

describe('insertPolyphonicMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAllTracksMock.mockReturnValue([]);
        getTransportStateMock.mockReturnValue({ tempo: 120 });
        addTrackMock.mockReturnValue(null);
    });

    it('returns null when a new MIDI track cannot be created', () => {
        const result = insertPolyphonicMidiNotes([], { startBeat: 0, endBeat: 1, name: 'x' }, 'missing-track');

        expect(result).toBeNull();
        expect(addClipMock).not.toHaveBeenCalled();
        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
    });
});
