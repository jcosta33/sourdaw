import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setNoteClipboard } from '../../../stores/clipboardStore';
import { pasteNotes } from '../pasteNotes';
import { createMidiNote } from '#/modules/MIDI/useCases';

vi.mock('#/modules/MIDI/useCases', () => ({
    createMidiNote: vi.fn(),
}));

describe('pasteNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setNoteClipboard(null);
    });

    it('returns early when the note clipboard is empty without calling createMidiNote', () => {
        pasteNotes('clip-id', 0);

        expect(createMidiNote).not.toHaveBeenCalled();
    });
});
