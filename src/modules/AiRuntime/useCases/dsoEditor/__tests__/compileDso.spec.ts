import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeDsos } from '../compileDso';

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addClip: vi.fn(),
    addDevice: vi.fn(),
    setSend: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    applyChordProgressionToTrack: vi.fn(),
    applyDrumPatternToTrack: vi.fn(),
    applyMelodyToTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    humanizeNotes: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: null },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    disableLooping: vi.fn(),
    setLoopRegion: vi.fn(),
}));

describe('executeDsos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs with an empty DSO list (smoke)', async () => {
        const summaries = await executeDsos([]);
        expect(summaries).toEqual([]);
    });
});
