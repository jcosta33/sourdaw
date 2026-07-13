import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendMidiNotes } from '#/modules/MIDI/useCases';

import { setNoteClipboard } from '../../../stores/clipboardStore';
import { pasteNotes } from '../pasteNotes';

vi.mock('#/modules/MIDI/useCases', () => ({
    appendMidiNotes: vi.fn(),
}));

describe('pasteNotes', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        setNoteClipboard(null);
    });

    it('does not invoke MIDI append when no note clipboard exists', () => {
        pasteNotes('clip-id', 0);

        expect(appendMidiNotes).not.toHaveBeenCalled();
    });

    it('does not invoke MIDI append when the note clipboard has no notes', () => {
        setNoteClipboard({ notes: [] });

        pasteNotes('clip-id', 0);

        expect(appendMidiNotes).not.toHaveBeenCalled();
    });

    it('delegates one clipboard-relative note batch to MIDI without creating IDs in Arrangement', () => {
        const laterNote = {
            id: 'clipboard-later',
            pitch: 72,
            startBeat: 16,
            duration: 0.5,
            velocity: 110,
            probability: 75,
            pressure: 0.25,
            slide: -0.5,
            pitchBend: 1024,
        };
        const earlierNote = {
            id: 'clipboard-earlier',
            pitch: 60,
            startBeat: 10,
            duration: 1,
            velocity: 90,
        };
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('unused-uuid');
        setNoteClipboard({ notes: [laterNote, earlierNote] });

        pasteNotes('destination-clip', 3);

        expect(appendMidiNotes).toHaveBeenCalledTimes(1);
        expect(appendMidiNotes).toHaveBeenCalledWith({
            clipId: 'destination-clip',
            notes: [
                { ...laterNote, startBeat: 9 },
                { ...earlierNote, startBeat: 3 },
            ],
        });
        expect(randomUuid).not.toHaveBeenCalled();
    });
});
