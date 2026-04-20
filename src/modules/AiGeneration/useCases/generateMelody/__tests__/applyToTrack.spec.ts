import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyMelodyToTrack } from '../applyToTrack';

const { batchAddMidiNotesMock } = vi.hoisted(() => ({
    batchAddMidiNotesMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: vi.fn().mockReturnValue(null),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    batchAddMidiNotes: batchAddMidiNotesMock,
}));

describe('applyMelodyToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not add notes when addClip fails', () => {
        applyMelodyToTrack('t1', { style: 'simple', key: 0, scale: 'major', bars: 1 }, 0);

        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
    });
});
