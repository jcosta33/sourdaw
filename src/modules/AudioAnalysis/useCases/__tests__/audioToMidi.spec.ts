import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioToMidi } from '../audioToMidi';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(() => ({ id: 'new-midi-clip' })),
    addTrack: vi.fn(() => ({ id: 'new-track' })),
    getAllTracks: vi.fn(),
    audioBufferCacheGet: vi.fn(),
    addMidiNote: vi.fn(),
    getTransportState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { get: mocks.audioBufferCacheGet },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.addMidiNote,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

describe('audioToMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
    });

    it('bails if clip or buffer is missing', () => {
        mocks.getAllTracks.mockReturnValue([]);
        audioToMidi({ clipId: 'c1', trackId: 't1' });
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('processes buffer onsets and creates MIDI notes', () => {
        const mockClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        mocks.getAllTracks.mockReturnValue([{ id: 't1', kind: 'audio', clips: [mockClip] }]);

        // Simple mock buffer: 1 second long, 44100 sample rate
        const mockBuffer = {
            sampleRate: 44100,
            length: 44100,
            getChannelData: () => new Float32Array(44100).map((_, i) => (i % 5000 < 100 ? 1.0 : 0)), // Some sharp onsets
        };
        mocks.audioBufferCacheGet.mockReturnValue(mockBuffer);

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(mocks.addTrack).toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalled();
        expect(mocks.addMidiNote).toHaveBeenCalled();
    });
});
