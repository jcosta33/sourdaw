import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyDrumPatternToTrack } from '../applyToTrack';

const { addClipMock, batchAddMidiNotesMock, generateDrumPatternMock } = vi.hoisted(() => ({
    addClipMock: vi.fn(),
    batchAddMidiNotesMock: vi.fn(),
    generateDrumPatternMock: vi.fn(),
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
        generateDrumPattern: generateDrumPatternMock,
    };
});

describe('applyDrumPatternToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addClipMock.mockReturnValue({ id: 'clip-1' });
        generateDrumPatternMock.mockReturnValue({
            notes: [
                { pitch: 36, startBeat: 0, duration: 0.5, velocity: 100 },
                { pitch: 38, startBeat: 1, duration: 0.25, velocity: 90 },
            ],
            seed: 7,
        });
    });

    it('names the clip from style and time signature and forwards notes unchanged', () => {
        const result = applyDrumPatternToTrack('t1', { style: 'house', bars: 2, timeSignature: [3, 4] }, 4);

        expect(addClipMock).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 4,
            endBeat: 10,
            name: 'house drums',
            type: 'midi',
        });

        expect(batchAddMidiNotesMock).toHaveBeenCalledWith('clip-1', [
            { pitch: 36, startBeat: 0, duration: 0.5, velocity: 100 },
            { pitch: 38, startBeat: 1, duration: 0.25, velocity: 90 },
        ]);

        expect(result).toEqual({ clipId: 'clip-1', noteCount: 2 });
    });

    it('defaults to a 4/4 time signature when none is supplied', () => {
        applyDrumPatternToTrack('t1', { style: 'techno', bars: 1 }, 0);

        expect(addClipMock).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 0, endBeat: 4 }));
    });

    it('does not add notes when addClip fails', () => {
        addClipMock.mockReturnValue(null);

        const result = applyDrumPatternToTrack('t1', { style: 'house', bars: 1, timeSignature: [4, 4] }, 0);

        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });
});
