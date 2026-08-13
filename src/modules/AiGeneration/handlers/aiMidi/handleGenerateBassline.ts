import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { type Clip, type Track } from '#/modules/Arrangement/stores';
import { addClip, addTrackWithDeferredAddedEvent, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { addMidiNote, setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';
import { populateGeneratedMidiStateGuard } from './populateGeneratedMidiStateGuard';

type GenerateBasslineAction = Extract<AppAction, { type: 'generateBassline' }>;
type ReplayGeneratedMidiAction = Extract<AppAction, { type: 'replayGeneratedMidi' }>;
type MidiGenerationSource = NonNullable<ReturnType<typeof createMidiGenerationSourceGuard>>;

type GeneratedClipSnapshot = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: string;
};

type GenerateBasslineState = {
    sourceNotes: MidiClipNoteSnapshot[];
    isOriginalSourceCurrent: () => boolean;
    resultNotes: MidiClipNoteSnapshot[];
    materialized: boolean;
    targetTrackId: string;
    targetClipId: string;
    trackInverse: {
        trackId: string;
        generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
    };
    clipInverse: {
        clipId: string;
        generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
    };
    generatedClip: GeneratedClipSnapshot | null;
    redoAction: ReplayGeneratedMidiAction;
};

const generateBasslineStates = new WeakMap<GenerateBasslineAction, GenerateBasslineState>();

function ensureGenerateBasslineState(
    action: GenerateBasslineAction,
    source: MidiGenerationSource
): GenerateBasslineState {
    const existing = generateBasslineStates.get(action);
    if (existing) {
        return existing;
    }
    const targetTrackId = action.payload.trackId ?? `track-ai-${crypto.randomUUID()}`;
    const targetClipId = `clip-ai-${crypto.randomUUID()}`;
    const sourceNotes = source.notes.map((note) => ({ ...note }));
    const resultNotes: MidiClipNoteSnapshot[] = [];
    const style = action.payload.style ?? 'root-fifth';
    const sourceReplay = {
        trackId: source.trackId,
        clip: {
            ...source.clip,
            trackId: source.trackId,
            type: 'midi' as const,
        },
        notes: sourceNotes,
    };
    const targetClip = {
        id: targetClipId,
        trackId: targetTrackId,
        name: `Bassline (${style})`,
        startBeat: source.clip.startBeat,
        endBeat: source.clip.endBeat,
        type: 'midi' as const,
    };
    let redoAction: ReplayGeneratedMidiAction;
    if (action.payload.trackId) {
        redoAction = {
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: sourceReplay,
                    targetTrackId,
                    clip: targetClip,
                    notes: resultNotes,
                },
            },
        };
    } else {
        redoAction = {
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-track',
                    source: sourceReplay,
                    trackJson: '',
                    trackIndex: 0,
                    clip: targetClip,
                    notes: resultNotes,
                },
            },
        };
    }
    const state: GenerateBasslineState = {
        sourceNotes,
        isOriginalSourceCurrent: source.isCurrent,
        resultNotes,
        materialized: false,
        targetTrackId,
        targetClipId,
        trackInverse: {
            trackId: targetTrackId,
            generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
        },
        clipInverse: {
            clipId: targetClipId,
            generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
        },
        generatedClip: null,
        redoAction,
    };
    generateBasslineStates.set(action, state);
    return state;
}

function hasExactResult(state: GenerateBasslineState): boolean {
    if (!state.generatedClip) {
        return false;
    }
    return hasDurableMidiGenerationResult({
        trackId: state.targetTrackId,
        clip: state.generatedClip,
        notes: state.resultNotes,
        noteMatch: 'exact',
    });
}

function createWrittenResult(input: {
    style: string;
    state: GenerateBasslineState;
    trackCreation: ReturnType<typeof addTrackWithDeferredAddedEvent>;
}) {
    const logSuccess = (): void => {
        logger.info(`[AI MIDI] Generated ${input.style} bassline with ${String(input.state.resultNotes.length)} notes`);
    };
    return {
        status: 'written' as const,
        afterCommit: async () => {
            await input.trackCreation?.afterCommit();
            logSuccess();
        },
        afterAmbiguousCommit: async () => {
            if (hasExactResult(input.state)) {
                await input.trackCreation?.afterAmbiguousCommit();
                logSuccess();
            }
        },
    };
}

export const handleGenerateBassline = createHandler<'generateBassline'>({
    previewExecution: 'unsupported-async',
    execute: async (alpha) => {
        const existingState = generateBasslineStates.get(alpha);
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            if (existingState?.materialized) {
                return { status: 'conflict' };
            }
            notifyUser('Bassline generation failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const style = alpha.payload.style ?? 'root-fifth';
        if (alpha.payload.trackId) {
            const targetTrack = getTrackStoreState()?.tracks.find((track) => track.id === alpha.payload.trackId);
            if (!targetTrack || targetTrack.kind !== 'midi') {
                if (existingState?.materialized) {
                    return { status: 'conflict' };
                }
                notifyUser('Bassline generation failed: target MIDI track not found', 'error');
                return { status: 'no-write' };
            }
        }

        const state = ensureGenerateBasslineState(alpha, source);
        const transactionScope = captureAutomergeStorageTransactionScope();

        if (state.materialized) {
            if (hasExactResult(state)) {
                return { status: 'no-write' };
            }
            if (!state.isOriginalSourceCurrent()) {
                return { status: 'conflict' };
            }
            const currentState = getTrackStoreState();
            const currentTargetTrack = currentState?.tracks.find((track) => track.id === state.targetTrackId);
            const targetClipIdCollision =
                currentState?.tracks.some((track) => track.clips.some((clip) => clip.id === state.targetClipId)) ??
                true;
            if (targetClipIdCollision) {
                return { status: 'conflict' };
            }
            if (alpha.payload.trackId) {
                if (currentTargetTrack?.kind !== 'midi') {
                    return { status: 'conflict' };
                }
            } else if (currentTargetTrack) {
                return { status: 'conflict' };
            }

            const replayResult = transactionScope(() => {
                let targetTrack = currentTargetTrack ?? null;
                let trackCreation: ReturnType<typeof addTrackWithDeferredAddedEvent> = null;
                if (!alpha.payload.trackId) {
                    trackCreation = addTrackWithDeferredAddedEvent({
                        id: state.targetTrackId,
                        name: `Bass (${style})`,
                        kind: 'midi',
                        select: false,
                    });
                    targetTrack = trackCreation?.track ?? null;
                }
                if (!targetTrack || targetTrack.id !== state.targetTrackId) {
                    return { status: 'conflict' as const, trackCreation };
                }
                const generatedClip = state.generatedClip;
                if (!generatedClip) {
                    return { status: 'conflict' as const, trackCreation };
                }
                const targetClip = addClip({
                    id: state.targetClipId,
                    trackId: targetTrack.id,
                    startBeat: generatedClip.startBeat,
                    endBeat: generatedClip.endBeat,
                    name: generatedClip.name,
                    type: 'midi',
                });
                if (!targetClip || targetClip.id !== state.targetClipId) {
                    return { status: 'conflict' as const, trackCreation };
                }
                setNotesForClip(
                    targetClip.id,
                    state.resultNotes.map((note) => ({ ...note }))
                );
                return { status: 'written' as const, trackCreation };
            });
            if (replayResult.status === 'conflict') {
                return { status: 'conflict' };
            }
            return createWrittenResult({ style, state, trackCreation: replayResult.trackCreation });
        }

        const instruction = `Generate a ${style} bassline that harmonically fits these chord/melody notes. The bass should be in octave 2-3 (MIDI 36-59). Use a "${style}" pattern. Output the bass notes using addNotes.`;

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
                    id: state.targetTrackId,
                    name: `Bass (${style})`,
                    kind: 'midi',
                    select: false,
                });
                targetTrack = trackCreation?.track ?? null;
            }
            if (!targetTrack) {
                return { status: 'write-failed' } as const;
            }

            const targetClip: Clip | null = addClip({
                id: state.targetClipId,
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
        state.targetTrackId = completedTrack.id;
        state.trackInverse.trackId = completedTrack.id;
        state.targetClipId = completedClip.id;
        state.clipInverse.clipId = completedClip.id;
        state.generatedClip = {
            id: completedClip.id,
            name: completedClip.name,
            startBeat: completedClip.startBeat,
            endBeat: completedClip.endBeat,
            type: completedClip.type,
        };
        state.resultNotes.splice(0, state.resultNotes.length, ...writtenNotes.map((note) => ({ ...note })));
        const replayOperation = state.redoAction.payload.operation;
        replayOperation.clip = {
            id: completedClip.id,
            trackId: completedTrack.id,
            name: completedClip.name,
            startBeat: completedClip.startBeat,
            endBeat: completedClip.endBeat,
            type: 'midi',
        };
        if (replayOperation.kind === 'create-clip') {
            replayOperation.targetTrackId = completedTrack.id;
        }
        let generatedTrackForGuard: Track | null = null;
        if (replayOperation.kind === 'create-track') {
            const currentState = getTrackStoreState();
            const currentTrackIndex = currentState?.tracks.findIndex((track) => track.id === completedTrack.id) ?? -1;
            const currentGeneratedTrack = currentTrackIndex >= 0 ? currentState?.tracks[currentTrackIndex] : undefined;
            let replayTrack = completedTrack;
            if (!completedTrack.clips.some((clip) => clip.id === completedClip.id)) {
                replayTrack = { ...completedTrack, clips: [...completedTrack.clips, completedClip] };
            }
            generatedTrackForGuard = currentGeneratedTrack ?? replayTrack;
            replayOperation.trackJson = JSON.stringify(generatedTrackForGuard);
            replayOperation.trackIndex =
                currentTrackIndex >= 0 ? currentTrackIndex : (currentState?.tracks.length ?? 0);
        }
        if (alpha.payload.trackId) {
            populateGeneratedMidiStateGuard({
                guard: state.clipInverse.generatedMidiStateGuard,
                entity: completedClip,
                clipIds: [completedClip.id],
            });
        } else {
            let fallbackTrack = completedTrack;
            if (!completedTrack.clips.some((clip) => clip.id === completedClip.id)) {
                fallbackTrack = { ...completedTrack, clips: [...completedTrack.clips, completedClip] };
            }
            const guardedTrack = generatedTrackForGuard ?? fallbackTrack;
            populateGeneratedMidiStateGuard({
                guard: state.trackInverse.generatedMidiStateGuard,
                entity: guardedTrack,
                clipIds: [completedClip.id],
            });
        }
        state.materialized = true;

        return createWrittenResult({ style, state, trackCreation: writeResult.trackCreation });
    },
    describe: (action) => {
        const label = `AI: generate ${action.payload.style ?? 'root-fifth'} bassline`;
        const source = createMidiGenerationSourceGuard(action.payload.clipId);
        if (!source) {
            return { label, inverseAction: null };
        }
        const state = ensureGenerateBasslineState(action, source);
        if (action.payload.trackId) {
            return {
                label,
                inverseAction: { type: 'discardDuplicatedClip', payload: state.clipInverse },
                redoAction: state.redoAction,
            };
        }
        return {
            label,
            inverseAction: { type: 'discardCreatedTrack', payload: state.trackInverse },
            redoAction: state.redoAction,
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
