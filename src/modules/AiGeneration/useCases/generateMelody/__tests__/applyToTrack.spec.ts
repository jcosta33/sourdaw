import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyMelodyToTrack } from '../applyToTrack';

const { addClipMock, batchAddMidiNotesMock, generateMelodyMock } = vi.hoisted(() => ({
    addClipMock: vi.fn(),
    batchAddMidiNotesMock: vi.fn(),
    generateMelodyMock: vi.fn(),
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
        generateMelody: generateMelodyMock,
    };
});

describe('applyMelodyToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addClipMock.mockReturnValue({ id: 'clip-1' });
        generateMelodyMock.mockReturnValue({
            notes: [
                { pitch: 67, startBeat: 0, duration: 0.1, velocity: 95 },
                { pitch: 69, startBeat: 0.5, duration: 0.5, velocity: 85 },
            ],
            seed: 3,
        });
    });

    it('names the clip from style, key and scale, and clamps short note durations', () => {
        const result = applyMelodyToTrack('t1', { style: 'simple', key: 3, scale: 'minor', bars: 2 }, 2);

        expect(addClipMock).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 2,
            endBeat: 10,
            name: 'simple melody (D# Minor)',
            type: 'midi',
        });

        expect(batchAddMidiNotesMock).toHaveBeenCalledWith('clip-1', [
            { pitch: 67, startBeat: 0, duration: 0.25, velocity: 95 },
            { pitch: 69, startBeat: 0.5, duration: 0.5, velocity: 85 },
        ]);

        expect(result).toEqual({ clipId: 'clip-1', noteCount: 2 });
    });

    it('does not add notes when addClip fails', () => {
        addClipMock.mockReturnValue(null);

        const result = applyMelodyToTrack('t1', { style: 'simple', key: 0, scale: 'major', bars: 1 }, 0);

        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });
});
