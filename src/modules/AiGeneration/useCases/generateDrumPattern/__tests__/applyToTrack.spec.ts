import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyDrumPatternToTrack } from '../applyToTrack';

const { addMidiNoteMock } = vi.hoisted(() => ({
    addMidiNoteMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: vi.fn().mockReturnValue(null),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: addMidiNoteMock,
}));

describe('applyDrumPatternToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not add notes when addClip fails', () => {
        applyDrumPatternToTrack(
            't1',
            { style: 'house', bars: 1, timeSignature: [4, 4] },
            0
        );

        expect(addMidiNoteMock).not.toHaveBeenCalled();
    });
});
