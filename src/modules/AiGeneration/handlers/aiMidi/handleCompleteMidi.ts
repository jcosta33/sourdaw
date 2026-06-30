import { logger } from '#/infra/logger/appLogger';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addClip, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { addMidiNote, getNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
            const trackState = getTrackStoreState();
            const refTrack = trackState?.tracks.find((t) => t.clips.some((c) => c.id === alpha.payload.clipId));
            const refClip = refTrack?.clips.find((c) => c.id === alpha.payload.clipId);

            if (!refTrack || !refClip) {
                // Surface the failure instead of silently skipping the branch and
                // then logging a misleading "Completed N notes (backward)".
                notifyUser('Complete MIDI failed: source clip not found', 'error');
                throw new Error('Complete MIDI (backward): source clip not found');
            }

            // Bounds for the new prepended clip. Its local length is the gap we
            // can fit before the original clip — never wider than `bars * 4`.
            const durationBeats = bars * 4;
            const newStartBeat = Math.max(0, refClip.startBeat - durationBeats);
            const clipLength = refClip.startBeat - newStartBeat;

            // The LLM emits notes relative to the original clip (e.g. -4 → 0 for a
            // lead-in). Normalize so the earliest note sits at the new clip's
            // start, then clamp each note to the clip bounds so nothing overflows
            // past `endBeat` (the abutment to the original clip).
            const minBeat = notes.reduce((acc, n) => Math.min(acc, n.startBeat), 0);

            const newClip = addClip({
                trackId: refTrack.id,
                startBeat: newStartBeat,
                endBeat: refClip.startBeat, // abut up to the original clip
                name: `${refClip.name} (intro)`,
                type: 'midi',
            });

            if (newClip) {
                let placed = 0;
                for (const note of notes) {
                    const shiftedStart = note.startBeat - minBeat;
                    // Drop notes that fall at or beyond the clip end after shifting.
                    if (shiftedStart >= clipLength) {
                        continue;
                    }
                    const clampedStart = Math.max(0, shiftedStart);
                    // Trim duration so the note end never crosses the clip end.
                    const maxDuration = clipLength - clampedStart;
                    const clampedDuration = Math.min(note.duration, maxDuration);
                    if (clampedDuration <= 0) {
                        continue;
                    }
                    addMidiNote(newClip.id, note.pitch, clampedStart, clampedDuration, note.velocity ?? 100);
                    placed += 1;
                }
                logger.info(`[AI MIDI] Completed ${String(placed)} notes (${direction})`);
            }
            return;
        }

        for (const note of notes) {
            addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
        }

        logger.info(`[AI MIDI] Completed ${String(notes.length)} notes (${direction})`);
    },
    describe: () => ({ label: 'AI: complete MIDI phrase' }),
    undoable: true,
});
