import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { createMidiNote, setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';

export const handleVariationMidi = createHandler<'variationMidi'>({
    execute: async (alpha) => {
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            notifyUser('MIDI variation failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const amount = alpha.payload.amount ?? 0.3;

        const pct = Math.round(amount * 100);
        const instruction = `Create a variation of these notes. Change ~${String(pct)}% of them — alter some pitches, shift some rhythms, or change velocities, but keep the overall feel and key. Output the COMPLETE set of notes for the clip (replacing all existing notes). The variation should sound like a B-section or alternate take.`;

        const transactionScope = captureAutomergeStorageTransactionScope();
        const notes = await llmGenerateNotes(generateToolCalls, instruction, source.notes, alpha.payload.clipId);
        if (!source.isCurrent()) {
            return { status: 'conflict' };
        }

        const newNotes = notes.map((note) =>
            createMidiNote(
                Math.max(0, Math.min(127, Math.round(note.pitch))),
                Math.max(0, note.startBeat),
                Math.max(0.0625, note.duration),
                Math.max(1, Math.min(127, note.velocity ?? 100))
            )
        );
        transactionScope(() => {
            setNotesForClip(alpha.payload.clipId, newNotes);
        });

        const logSuccess = (): void => {
            logger.info(
                `[AI MIDI] Generated variation with ${String(newNotes.length)} notes (replaced ${String(source.notes.length)} existing)`
            );
        };
        const isDurable = (): boolean =>
            hasDurableMidiGenerationResult({
                trackId: source.trackId,
                clip: source.clip,
                notes: newNotes,
                noteMatch: 'exact',
            });

        return {
            status: 'written',
            afterCommit: logSuccess,
            afterAmbiguousCommit: () => {
                if (isDurable()) {
                    logSuccess();
                }
            },
        };
    },
    describe: () => ({ label: 'AI: create MIDI variation' }),
    undoable: true,
});
