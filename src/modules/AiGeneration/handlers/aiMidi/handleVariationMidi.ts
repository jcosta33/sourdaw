import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { createMidiNote, getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { llmGenerateNotes } from './llmNoteHelpers';

export const handleVariationMidi = createHandler<'variationMidi'>({
    execute: async (a) => {
        const existing = getNotesForClip(a.payload.clipId);
        const amount = a.payload.amount ?? 0.3;

        const pct = Math.round(amount * 100);
        const instruction = `Create a variation of these notes. Change ~${String(pct)}% of them — alter some pitches, shift some rhythms, or change velocities, but keep the overall feel and key. Output the COMPLETE set of notes for the clip (replacing all existing notes). The variation should sound like a B-section or alternate take.`;

        const notes = await llmGenerateNotes(generateToolCalls, instruction, existing, a.payload.clipId);
        const newNotes = notes.map((note) =>
            createMidiNote(
                Math.max(0, Math.min(127, Math.round(note.pitch))),
                Math.max(0, note.startBeat),
                Math.max(0.0625, note.duration),
                Math.max(1, Math.min(127, note.velocity ?? 100))
            )
        );
        setNotesForClip(a.payload.clipId, newNotes);
        logger.info(
            `[AI MIDI] Generated variation with ${String(newNotes.length)} notes (replaced ${String(existing.length)} existing)`
        );
    },
    describe: () => ({ label: 'AI: create MIDI variation' }),
    undoable: true,
});
