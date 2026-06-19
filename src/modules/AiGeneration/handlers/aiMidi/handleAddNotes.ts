import { logger } from '#/infra/logger/appLogger';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddNotes = createHandler<'addNotes'>({
    execute: (alpha) => {
        const notes = alpha.payload.notes;
        if (!Array.isArray(notes) || notes.length === 0) {
            return;
        }
        let added = 0;
        for (const note of notes) {
            // Skip notes with non-finite fields. typeof === 'number' passes for NaN,
            // and Math.round/min/max are NaN-fixed-points, so a NaN pitch/start/duration
            // would otherwise be written verbatim into the clip. velocity defaults to 100.
            const velocityRaw = note.velocity ?? 100;
            if (
                !Number.isFinite(note.pitch) ||
                !Number.isFinite(note.startBeat) ||
                !Number.isFinite(note.duration) ||
                !Number.isFinite(velocityRaw)
            ) {
                continue;
            }
            const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
            const start = Math.max(0, note.startBeat);
            const dur = Math.max(0.0625, note.duration);
            const vel = Math.max(1, Math.min(127, velocityRaw));
            addMidiNote(alpha.payload.clipId, pitch, start, dur, vel);
            added++;
        }
        logger.info(`[AI MIDI] Added ${String(added)} notes to clip ${alpha.payload.clipId}`);
    },
    describe: (alpha) => ({ label: `Add ${String(alpha.payload.notes.length)} MIDI notes` }),
    undoable: true,
});
