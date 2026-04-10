import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAddNotes } from '../handlers/aiMidi/handleAddNotes';

vi.mock('#/modules/MIDI', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI')>();
    return {
        ...actual,
        addMidiNote: vi.fn(),
    };
});

describe('aiMidiHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleAddNotes forwards notes to addMidiNote', async () => {
        const { addMidiNote } = await import('#/modules/MIDI');

        handleAddNotes.execute({
            type: 'addNotes',
            payload: {
                clipId: 'clip1',
                notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });

        expect(addMidiNote).toHaveBeenCalledWith('clip1', 60, 0, 1, 100);
    });
});
