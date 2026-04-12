import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioToMidi } from '../audioToMidi';

const getTransportStateMock = vi.fn();
const getAllTracksMock = vi.fn().mockReturnValue([]);
const addTrackMock = vi.fn();
const addClipMock = vi.fn();
const addMidiNoteMock = vi.fn();

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: (...args: any[]) => getAllTracksMock(...args),
    addTrack: (...args: any[]) => addTrackMock(...args),
    addClip: (...args: any[]) => addClipMock(...args),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: new Map(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: (...args: any[]) => addMidiNoteMock(...args),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: (...args: any[]) => getTransportStateMock(...args),
}));

describe('audioToMidi (AudioAnalysis)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAllTracksMock.mockReturnValue([]);
    });

    it('returns early when no clip matches the id', () => {
        audioToMidi({ clipId: 'missing', trackId: 't1' });

        expect(addTrackMock).not.toHaveBeenCalled();
        expect(addClipMock).not.toHaveBeenCalled();
    });
});
