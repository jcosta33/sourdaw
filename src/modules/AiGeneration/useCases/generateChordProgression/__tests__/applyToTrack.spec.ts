import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyChordProgressionToTrack } from '../applyToTrack';

const { addClipMock, batchAddMidiNotesMock, generateChordProgressionMock } = vi.hoisted(() => ({
    addClipMock: vi.fn(),
    batchAddMidiNotesMock: vi.fn(),
    generateChordProgressionMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: addClipMock,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    batchAddMidiNotes: batchAddMidiNotesMock,
}));

vi.mock('../algorithm', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../algorithm');
    return {
        ...actual,
        generateChordProgression: generateChordProgressionMock,
    };
});

describe('applyChordProgressionToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addClipMock.mockReturnValue({ id: 'clip-1' });
        generateChordProgressionMock.mockReturnValue({
            notes: [
                { pitch: 60, startBeat: 0, duration: 0.1, velocity: 90 },
                { pitch: 64, startBeat: 1, duration: 1, velocity: 80 },
            ],
            seed: 42,
        });
    });

    it('names the clip from style, key and scale, and clamps short note durations', () => {
        const result = applyChordProgressionToTrack('t1', { style: 'pop', key: 1, scale: 'major', bars: 2 }, 8);

        expect(addClipMock).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 8,
            endBeat: 16,
            name: 'pop chords (C# Major)',
            type: 'midi',
        });

        expect(batchAddMidiNotesMock).toHaveBeenCalledWith('clip-1', [
            { pitch: 60, startBeat: 0, duration: 0.25, velocity: 90 },
            { pitch: 64, startBeat: 1, duration: 1, velocity: 80 },
        ]);

        expect(result).toEqual({ clipId: 'clip-1', noteCount: 2 });
    });

    it('falls back to C when key is out of the 0-11 range name table', () => {
        applyChordProgressionToTrack('t1', { style: 'jazz', key: 24, scale: 'minor', bars: 1 }, 0);

        expect(addClipMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'jazz chords (C Minor)' }));
    });

    it('does not add notes when addClip fails', () => {
        addClipMock.mockReturnValue(null);

        const result = applyChordProgressionToTrack('t1', { style: 'pop', key: 0, scale: 'major', bars: 1 }, 0);

        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });
});
