import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addClip, addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

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

        // If we created a new track, we must create a new clip on THAT track to
        // hold the notes. If the reference clip can't be found (or the new clip
        // can't be created), bail with a notification — falling back to the
        // source clip id would append the bassline onto the original clip on a
        // different track, silently mis-placing it.
        if (targetId !== alpha.payload.trackId) {
            const trackState = getTrackStoreState();
            const refTrack = trackState?.tracks.find((t) => t.clips.some((c) => c.id === alpha.payload.clipId));
            const refClip = refTrack?.clips.find((c) => c.id === alpha.payload.clipId);

            if (!refClip) {
                notifyUser('Bassline generation failed: source clip not found', 'error');
                throw new Error('Generate bassline: source clip not found');
            }

            const newClip = addClip({
                trackId: targetId,
                startBeat: refClip.startBeat,
                endBeat: refClip.endBeat,
                name: `Bassline (${style})`,
                type: 'midi',
            });
            if (!newClip) {
                notifyUser('Bassline generation failed: could not create clip', 'error');
                throw new Error('Generate bassline: could not create clip on new track');
            }
            targetClipId = newClip.id;
        }

        for (const note of notes) {
            addMidiNote(targetClipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Generated ${style} bassline with ${String(notes.length)} notes`);
    },
    describe: (alpha) => ({ label: `AI: generate ${alpha.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
