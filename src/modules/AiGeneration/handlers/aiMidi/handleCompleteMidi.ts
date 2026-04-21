import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { llmGenerateNotes } from './llmNoteHelpers';

export const handleCompleteMidi = createHandler<'completeMidi'>({
    execute: async (alpha) => {
        const existing = getNotesForClip(alpha.payload.clipId);
        const bars = alpha.payload.bars ?? 4;
        const direction = alpha.payload.direction ?? 'forward';

        let maxBeat = 0;
        for (const node of existing) {
            const value = node.startBeat + node.duration;
            if (value > maxBeat) {
                maxBeat = value;
            }
        }

        const instruction =
            direction === 'forward'
                ? `Continue this melody/pattern for ${String(bars)} more bars (${String(bars * 4)} beats), starting from beat ${String(maxBeat)}. Match the style, rhythm, and key of the existing notes.`
                : `Write ${String(bars)} bars of content BEFORE beat 0 as a lead-in/intro, matching the style.`;

        const notes = await llmGenerateNotes(generateToolCalls, instruction, existing, alpha.payload.clipId);
        for (const note of notes) {
            addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }
        logger.info(`[AI MIDI] Completed ${String(notes.length)} notes (${direction})`);
    },
    describe: () => ({ label: 'AI: complete MIDI phrase' }),
    undoable: true,
});
