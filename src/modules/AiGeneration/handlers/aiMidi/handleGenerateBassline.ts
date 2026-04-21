import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addTrack } from '#/modules/Arrangement/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { llmGenerateNotes } from './llmNoteHelpers';

export const handleGenerateBassline = createHandler<'generateBassline'>({
    execute: async (alpha) => {
        const referenceNotes = getNotesForClip(alpha.payload.clipId);
        const style = alpha.payload.style ?? 'root-fifth';

        let targetId = alpha.payload.trackId;
        if (!targetId) {
            const newTrack = addTrack({ name: `Bass (${style})`, kind: 'midi' });
            targetId = newTrack?.id;
        }
        if (!targetId) {
            return;
        }

        const instruction = `Generate a ${style} bassline that harmonically fits these chord/melody notes. The bass should be in octave 2-3 (MIDI 36-59). Use a "${style}" pattern. Output the bass notes using addNotes.`;

        const notes = await llmGenerateNotes(generateToolCalls, instruction, referenceNotes, alpha.payload.clipId);
        for (const note of notes) {
            addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Generated ${style} bassline with ${String(notes.length)} notes`);
    },
    describe: (alpha) => ({ label: `AI: generate ${alpha.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
