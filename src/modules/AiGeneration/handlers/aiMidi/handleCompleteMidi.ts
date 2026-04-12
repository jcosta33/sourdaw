import { createHandler } from '#/utils/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI/useCases';
import { llmGenerateNotes } from './llmNoteHelpers';

export const handleCompleteMidi = createHandler<'completeMidi'>({
    execute: async (a) => {
        const existing = getNotesForClip(a.payload.clipId);
        const bars = a.payload.bars ?? 4;
        const direction = a.payload.direction ?? 'forward';

        let maxBeat = 0;
        for (const n of existing) {
            const v = n.startBeat + n.duration;
            if (v > maxBeat) { maxBeat = v; }
        }

        const instruction =
            direction === 'forward'
                ? `Continue this melody/pattern for ${String(bars)} more bars (${String(bars * 4)} beats), starting from beat ${String(maxBeat)}. Match the style, rhythm, and key of the existing notes.`
                : `Write ${String(bars)} bars of content BEFORE beat 0 as a lead-in/intro, matching the style.`;

        const notes = await llmGenerateNotes(generateToolCalls, instruction, existing, a.payload.clipId);
        for (const note of notes) {
            addMidiNote(a.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Completed ${String(notes.length)} notes (${direction})`);
    },
    describe: () => ({ label: 'AI: complete MIDI phrase' }),
    undoable: true,
});
