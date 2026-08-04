import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';

export const handleCompleteMidi = createHandler<'completeMidi'>({
    execute: async (alpha) => {
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            notifyUser('Complete MIDI failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const bars = alpha.payload.bars ?? 4;
        const direction = alpha.payload.direction ?? 'forward';
        if (direction === 'backward' && source.clip.startBeat <= 0) {
            notifyUser('Complete MIDI failed: no room before the source clip', 'error');
            return { status: 'no-write' };
        }

        let maxBeat = 0;
        for (const node of source.notes) {
            const value = node.startBeat + node.duration;
            if (value > maxBeat) {
                maxBeat = value;
            }
        }

        const instruction =
            direction === 'forward'
                ? `Continue this melody/pattern for ${String(bars)} more bars (${String(bars * 4)} beats), starting from beat ${String(maxBeat)}. Match the style, rhythm, and key of the existing notes.`
                : `Write ${String(bars)} bars of content BEFORE beat 0 as a lead-in/intro, matching the style.`;

        const transactionScope = captureAutomergeStorageTransactionScope();
        const notes = await llmGenerateNotes(generateToolCalls, instruction, source.notes, alpha.payload.clipId, {
            allowNegativeStartBeat: direction === 'backward',
        });
        if (!source.isCurrent()) {
            return { status: 'conflict' };
        }

        if (direction === 'backward') {
            const durationBeats = bars * 4;
            const newStartBeat = Math.max(0, source.clip.startBeat - durationBeats);
            const clipLength = source.clip.startBeat - newStartBeat;
            const minBeat = notes.reduce((acc, n) => Math.min(acc, n.startBeat), 0);
            const placedNotes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }> = [];
            for (const note of notes) {
                const shiftedStart = note.startBeat - minBeat;
                if (shiftedStart >= clipLength) {
                    continue;
                }
                const clampedStart = Math.max(0, shiftedStart);
                const clampedDuration = Math.min(note.duration, clipLength - clampedStart);
                if (clampedDuration <= 0) {
                    continue;
                }
                placedNotes.push({
                    pitch: note.pitch,
                    startBeat: clampedStart,
                    duration: clampedDuration,
                    velocity: note.velocity ?? 100,
                });
            }
            if (placedNotes.length === 0) {
                notifyUser('Complete MIDI failed: generated notes do not fit before the source clip', 'error');
                return { status: 'no-write' };
            }

            const writeResult = transactionScope(() => {
                const createdClip = addClip({
                    trackId: source.trackId,
                    startBeat: newStartBeat,
                    endBeat: source.clip.startBeat,
                    name: `${source.clip.name} (intro)`,
                    type: 'midi',
                });
                if (!createdClip) {
                    return null;
                }

                const writtenNotes: Array<ReturnType<typeof addMidiNote>> = [];
                for (const note of placedNotes) {
                    writtenNotes.push(
                        addMidiNote(createdClip.id, note.pitch, note.startBeat, note.duration, note.velocity)
                    );
                }
                return { clip: createdClip, notes: writtenNotes };
            });
            if (!writeResult) {
                notifyUser('Complete MIDI failed: could not create intro clip', 'error');
                return { status: 'no-write' };
            }

            const completedClip = writeResult.clip;
            const writtenNotes = writeResult.notes;
            const logSuccess = (): void => {
                logger.info(`[AI MIDI] Completed ${String(writtenNotes.length)} notes (${direction})`);
            };
            const isDurable = (): boolean =>
                hasDurableMidiGenerationResult({
                    trackId: source.trackId,
                    clip: completedClip,
                    notes: writtenNotes,
                    noteMatch: 'contains',
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
        }

        const writtenNotes: Array<ReturnType<typeof addMidiNote>> = [];
        transactionScope(() => {
            for (const note of notes) {
                writtenNotes.push(
                    addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100)
                );
            }
        });

        const logSuccess = (): void => {
            logger.info(`[AI MIDI] Completed ${String(writtenNotes.length)} notes (${direction})`);
        };
        const isDurable = (): boolean =>
            hasDurableMidiGenerationResult({
                trackId: source.trackId,
                clip: source.clip,
                notes: writtenNotes,
                noteMatch: 'contains',
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
    describe: () => ({ label: 'AI: complete MIDI phrase' }),
    undoable: true,
});
