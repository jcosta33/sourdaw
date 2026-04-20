import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI';
import { createHandler } from '#/utils/createHandler';

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
        
        let targetClipId = a.payload.clipId;
        
        // If we created a new track, we need to create a new clip on it to hold the notes
        if (targetId !== a.payload.trackId) {
             const trackState = trackStore.value;
             const refTrack = trackState?.tracks.find(t => t.clips.some(c => c.id === a.payload.clipId));
             const refClip = refTrack?.clips.find(c => c.id === a.payload.clipId);
             
             if (refClip) {
                 const newClip = addClip({
                     trackId: targetId,
                     startBeat: refClip.startBeat,
                     endBeat: refClip.endBeat,
                     name: `Bassline (${style})`,
                     type: 'midi'
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
    describe: (a) => ({ label: `AI: generate ${a.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
