import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChordProgressionToTrack } from '../applyToTrack';

const { addMidiNoteMock } = vi.hoisted(() => ({
    addMidiNoteMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: vi.fn().mockReturnValue(null),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: addMidiNoteMock,
}));

describe('applyChordProgressionToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not add notes when addClip fails', () => {
        applyChordProgressionToTrack('t1', { style: 'pop', key: 0, scale: 'major', bars: 1 }, 0);

        expect(addMidiNoteMock).not.toHaveBeenCalled();
    });
});
