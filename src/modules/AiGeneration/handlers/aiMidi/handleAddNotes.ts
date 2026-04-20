import { logger } from '#/infra/logger/appLogger';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddNotes = createHandler<'addNotes'>({
    execute: (a) => {
        const notes = a.payload.notes;
        if (!Array.isArray(notes) || notes.length === 0) {
            return;
        }
        for (const note of notes) {
            const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
            const start = Math.max(0, note.startBeat);
            const dur = Math.max(0.0625, note.duration);
            const vel = Math.max(1, Math.min(127, note.velocity ?? 100));
            addMidiNote(a.payload.clipId, pitch, start, dur, vel);
        }
        logger.info(`[AI MIDI] Added ${String(notes.length)} notes to clip ${a.payload.clipId}`);
    },
    describe: (a) => ({ label: `Add ${String(a.payload.notes.length)} MIDI notes` }),
    undoable: true,
});
