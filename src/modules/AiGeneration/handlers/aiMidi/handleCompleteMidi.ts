import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip } from '#/modules/Arrangement/useCases';
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

        if (direction === 'backward') {
            const trackState = trackStore.value;
            const refTrack = trackState?.tracks.find((t) => t.clips.some((c) => c.id === alpha.payload.clipId));
            const refClip = refTrack?.clips.find((c) => c.id === alpha.payload.clipId);

            if (refTrack && refClip) {
                // Calculate bounds for the new prepended clip
                // The LLM generated notes with negative startBeat values (e.g. -4 to 0)
                // We normalize these to a 0-indexed clip
                let minBeat = 0;
                for (const n of notes) {
                    if (n.startBeat < minBeat) {
                        minBeat = n.startBeat;
                    }
                }

                const durationBeats = bars * 4;
                const newStartBeat = Math.max(0, refClip.startBeat - durationBeats);

                const newClip = addClip({
                    trackId: refTrack.id,
                    startBeat: newStartBeat,
                    endBeat: refClip.startBeat, // abut up to the original clip
                    name: `${refClip.name} (intro)`,
                    type: 'midi',
                });

                if (newClip) {
                    for (const note of notes) {
                        // Shift notes so the lowest negative value becomes 0 relative to the new clip
                        const shiftedStart = note.startBeat - minBeat;
                        addMidiNote(newClip.id, note.pitch, shiftedStart, note.duration, note.velocity ?? 100);
                    }
                }
            }
        } else {
            for (const note of notes) {
                addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
            }
        }

        logger.info(`[AI MIDI] Completed ${String(notes.length)} notes (${direction})`);
    },
    describe: () => ({ label: 'AI: complete MIDI phrase' }),
    undoable: true,
});
