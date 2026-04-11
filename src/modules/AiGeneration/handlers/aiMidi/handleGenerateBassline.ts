import { createHandler } from '#/helpers/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { addTrack } from '#/modules/Arrangement/useCases';
import { generateToolCalls } from '#/modules/AiRuntime';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI';
import { llmGenerateNotes } from './llmNoteHelpers';

export const handleGenerateBassline = createHandler<'generateBassline'>({
    execute: async (a) => {
        const referenceNotes = getNotesForClip(a.payload.clipId);
        const style = a.payload.style ?? 'root-fifth';

        let targetId = a.payload.trackId;
        if (!targetId) {
            const newTrack = addTrack({ name: `Bass (${style})`, kind: 'midi' });
            targetId = newTrack?.id;
        }
        if (!targetId) {
            return;
        }

        const instruction = `Generate a ${style} bassline that harmonically fits these chord/melody notes. The bass should be in octave 2-3 (MIDI 36-59). Use a "${style}" pattern. Output the bass notes using addNotes.`;

        const notes = await llmGenerateNotes(generateToolCalls, instruction, referenceNotes, a.payload.clipId);
        for (const note of notes) {
            addMidiNote(a.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Generated ${style} bassline with ${String(notes.length)} notes`);
    },
    describe: (a) => ({ label: `AI: generate ${a.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
