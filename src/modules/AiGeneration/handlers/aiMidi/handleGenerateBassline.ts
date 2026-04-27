import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
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

        let targetClipId = alpha.payload.clipId;

        // If we created a new track, we need to create a new clip on it to hold the notes
        if (targetId !== alpha.payload.trackId) {
            const trackState = trackStore.value;
            const refTrack = trackState?.tracks.find((t) => t.clips.some((c) => c.id === alpha.payload.clipId));
            const refClip = refTrack?.clips.find((c) => c.id === alpha.payload.clipId);

            if (refClip) {
                const newClip = addClip({
                    trackId: targetId,
                    startBeat: refClip.startBeat,
                    endBeat: refClip.endBeat,
                    name: `Bassline (${style})`,
                    type: 'midi',
                });
                if (newClip) {
                    targetClipId = newClip.id;
                }
            }
        }

        for (const note of notes) {
            addMidiNote(targetClipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Generated ${style} bassline with ${String(notes.length)} notes`);
    },
    describe: (alpha) => ({ label: `AI: generate ${alpha.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
