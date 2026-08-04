import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { type Clip, type Track } from '#/modules/Arrangement/stores';
import { addClip, addTrackWithDeferredAddedEvent, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';

export const handleGenerateBassline = createHandler<'generateBassline'>({
    execute: async (alpha) => {
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            notifyUser('Bassline generation failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const style = alpha.payload.style ?? 'root-fifth';
        if (alpha.payload.trackId) {
            const targetTrack = getTrackStoreState()?.tracks.find((track) => track.id === alpha.payload.trackId);
            if (!targetTrack || targetTrack.kind !== 'midi') {
                notifyUser('Bassline generation failed: target MIDI track not found', 'error');
                return { status: 'no-write' };
            }
        }

        const instruction = `Generate a ${style} bassline that harmonically fits these chord/melody notes. The bass should be in octave 2-3 (MIDI 36-59). Use a "${style}" pattern. Output the bass notes using addNotes.`;

        const transactionScope = captureAutomergeStorageTransactionScope();
        const notes = await llmGenerateNotes(generateToolCalls, instruction, source.notes, alpha.payload.clipId);
        if (!source.isCurrent()) {
            return { status: 'conflict' };
        }

        const writeResult = transactionScope(() => {
            let targetTrack: Track | null;
            let trackCreation: ReturnType<typeof addTrackWithDeferredAddedEvent> = null;
            if (alpha.payload.trackId) {
                targetTrack = getTrackStoreState()?.tracks.find((track) => track.id === alpha.payload.trackId) ?? null;
                if (targetTrack?.kind !== 'midi') {
                    return { status: 'target-conflict' } as const;
                }
            } else {
                trackCreation = addTrackWithDeferredAddedEvent({
                    name: `Bass (${style})`,
                    kind: 'midi',
                });
                targetTrack = trackCreation?.track ?? null;
            }
            if (!targetTrack) {
                return { status: 'write-failed' } as const;
            }

            const targetClip: Clip | null = addClip({
                trackId: targetTrack.id,
                startBeat: source.clip.startBeat,
                endBeat: source.clip.endBeat,
                name: `Bassline (${style})`,
                type: 'midi',
            });
            if (!targetClip) {
                return { status: 'write-failed' } as const;
            }

            const writtenNotes: Array<ReturnType<typeof addMidiNote>> = [];
            for (const note of notes) {
                writtenNotes.push(
                    addMidiNote(targetClip.id, note.pitch, note.startBeat, note.duration, note.velocity ?? 100)
                );
            }
            return {
                status: 'written',
                track: targetTrack,
                clip: targetClip,
                notes: writtenNotes,
                trackCreation,
            } as const;
        });
        if (writeResult.status === 'target-conflict') {
            return { status: 'conflict' };
        }
        if (writeResult.status === 'write-failed') {
            notifyUser('Bassline generation failed: could not create the target clip', 'error');
            return { status: 'no-write' };
        }

        const completedTrack = writeResult.track;
        const completedClip = writeResult.clip;
        const writtenNotes = writeResult.notes;
        const logSuccess = (): void => {
            logger.info(`[AI MIDI] Generated ${style} bassline with ${String(writtenNotes.length)} notes`);
        };
        const isDurable = (): boolean =>
            hasDurableMidiGenerationResult({
                trackId: completedTrack.id,
                clip: completedClip,
                notes: writtenNotes,
                noteMatch: 'contains',
            });
        const publishEffects = async (): Promise<void> => {
            await writeResult.trackCreation?.afterCommit();
            logSuccess();
        };

        return {
            status: 'written',
            afterCommit: publishEffects,
            afterAmbiguousCommit: async () => {
                if (isDurable()) {
                    await writeResult.trackCreation?.afterAmbiguousCommit();
                    logSuccess();
                }
            },
        };
    },
    describe: (alpha) => ({ label: `AI: generate ${alpha.payload.style ?? 'root-fifth'} bassline` }),
    undoable: true,
});
