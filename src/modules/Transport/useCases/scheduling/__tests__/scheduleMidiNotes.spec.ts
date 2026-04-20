import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getSynthParamsForTrack } from '#/modules/Arrangement/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { scheduleMidiNotes } from '../scheduleMidiNotes';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn(() => []),
    getSynthParamsForTrack: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCompensationDelay: vi.fn(() => 0),
    ensureTrackStrip: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDrumKitByIndex: vi.fn(() => null),
    getAudioContext: vi.fn(() => ({
        sampleRate: 48000,
    })),
    createBufferSource: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleFaustNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/stores', () => ({
    getYeastRack: vi.fn(() => ({ getProcessorIds: () => [], processBlock: vi.fn() })),
    getYeastWorkletNodeAsync: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getChordAtBeat: vi.fn(),
    transposeForChordTrack: vi.fn((p) => p),
}));

describe('scheduleMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not schedule synth when MIDI store is uninitialized', async () => {
        await scheduleMidiNotes(0, 4, 0, 0, [], defaultTransportState, 120);

        expect(getSynthParamsForTrack).not.toHaveBeenCalled();
    });
});
