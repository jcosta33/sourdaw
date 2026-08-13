import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { addClip, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { addMidiNote, setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';
import { populateGeneratedMidiStateGuard } from './populateGeneratedMidiStateGuard';

type CompleteMidiAction = Extract<AppAction, { type: 'completeMidi' }>;
type ReplayGeneratedMidiAction = Extract<AppAction, { type: 'replayGeneratedMidi' }>;
type MidiGenerationSource = NonNullable<ReturnType<typeof createMidiGenerationSourceGuard>>;

type CompleteMidiState = {
    sourceTrackId: string;
    sourceClip: MidiGenerationSource['clip'];
    sourceNotes: MidiClipNoteSnapshot[];
    isOriginalSourceCurrent: () => boolean;
    resultNotes: MidiClipNoteSnapshot[];
    materialized: boolean;
    generatedClipId: string;
    generatedClipInverse: {
        clipId: string;
        generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
    };
    generatedClip: {
        id: string;
        name: string;
        startBeat: number;
        endBeat: number;
        type: string;
    } | null;
    redoAction: ReplayGeneratedMidiAction;
};

const completeMidiStates = new WeakMap<CompleteMidiAction, CompleteMidiState>();

function createCompleteMidiRedoAction(input: {
    action: CompleteMidiAction;
    source: MidiGenerationSource;
    sourceNotes: MidiClipNoteSnapshot[];
    resultNotes: MidiClipNoteSnapshot[];
    generatedClipId: string;
}): ReplayGeneratedMidiAction {
    const sourceClip = {
        ...input.source.clip,
        trackId: input.source.trackId,
        type: 'midi' as const,
    };
    const direction = input.action.payload.direction ?? 'forward';
    if (direction === 'backward') {
        const bars = input.action.payload.bars ?? 4;
        return {
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: input.source.trackId, clip: sourceClip, notes: input.sourceNotes },
                    targetTrackId: input.source.trackId,
                    clip: {
                        id: input.generatedClipId,
                        trackId: input.source.trackId,
                        name: `${input.source.clip.name} (intro)`,
                        startBeat: Math.max(0, input.source.clip.startBeat - bars * 4),
                        endBeat: input.source.clip.startBeat,
                        type: 'midi',
                    },
                    notes: input.resultNotes,
                },
            },
        };
    }
    return {
        type: 'replayGeneratedMidi',
        payload: {
            operation: {
                kind: 'replace-notes',
                trackId: input.source.trackId,
                clip: sourceClip,
                expectedNotes: input.sourceNotes,
                replacementNotes: input.resultNotes,
            },
        },
    };
}

function ensureCompleteMidiState(action: CompleteMidiAction, source: MidiGenerationSource): CompleteMidiState {
    const existing = completeMidiStates.get(action);
    if (existing) {
        return existing;
    }
    const generatedClipId = `clip-ai-${crypto.randomUUID()}`;
    const sourceNotes = source.notes.map((note) => ({ ...note }));
    const resultNotes: MidiClipNoteSnapshot[] = [];
    const redoAction = createCompleteMidiRedoAction({
        action,
        source,
        sourceNotes,
        resultNotes,
        generatedClipId,
    });
    const state: CompleteMidiState = {
        sourceTrackId: source.trackId,
        sourceClip: { ...source.clip },
        sourceNotes,
        isOriginalSourceCurrent: source.isCurrent,
        resultNotes,
        materialized: false,
        generatedClipId,
        generatedClipInverse: {
            clipId: generatedClipId,
            generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
        },
        generatedClip: null,
        redoAction,
    };
    completeMidiStates.set(action, state);
    return state;
}

function hasExactSourceResult(state: CompleteMidiState, notes: readonly MidiClipNoteSnapshot[]): boolean {
    return hasDurableMidiGenerationResult({
        trackId: state.sourceTrackId,
        clip: state.sourceClip,
        notes,
        noteMatch: 'exact',
    });
}

function createWrittenResult(input: {
    direction: 'forward' | 'backward';
    noteCount: number;
    isDurable: () => boolean;
}) {
    const logSuccess = (): void => {
        logger.info(`[AI MIDI] Completed ${String(input.noteCount)} notes (${input.direction})`);
    };
    return {
        status: 'written' as const,
        afterCommit: logSuccess,
        afterAmbiguousCommit: () => {
            if (input.isDurable()) {
                logSuccess();
            }
        },
    };
}

export const handleCompleteMidi = createHandler<'completeMidi'>({
    previewExecution: 'unsupported-async',
    execute: async (alpha) => {
        const existingState = completeMidiStates.get(alpha);
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            if (existingState?.materialized) {
                return { status: 'conflict' };
            }
            notifyUser('Complete MIDI failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const bars = alpha.payload.bars ?? 4;
        const direction = alpha.payload.direction ?? 'forward';
        if (direction === 'backward' && source.clip.startBeat <= 0) {
            if (existingState?.materialized) {
                return { status: 'conflict' };
            }
            notifyUser('Complete MIDI failed: no room before the source clip', 'error');
            return { status: 'no-write' };
        }

        const state = ensureCompleteMidiState(alpha, source);
        const transactionScope = captureAutomergeStorageTransactionScope();

        if (state.materialized) {
            if (direction === 'forward') {
                if (hasExactSourceResult(state, state.resultNotes)) {
                    return { status: 'no-write' };
                }
                if (!state.isOriginalSourceCurrent()) {
                    return { status: 'conflict' };
                }
                transactionScope(() => {
                    setNotesForClip(
                        alpha.payload.clipId,
                        state.resultNotes.map((note) => ({ ...note }))
                    );
                });
                return createWrittenResult({
                    direction,
                    noteCount: state.resultNotes.length - state.sourceNotes.length,
                    isDurable: () => hasExactSourceResult(state, state.resultNotes),
                });
            }

            const generatedClip = state.generatedClip;
            if (!generatedClip || !state.isOriginalSourceCurrent()) {
                return { status: 'conflict' };
            }
            if (
                hasDurableMidiGenerationResult({
                    trackId: state.sourceTrackId,
                    clip: generatedClip,
                    notes: state.resultNotes,
                    noteMatch: 'exact',
                })
            ) {
                return { status: 'no-write' };
            }
            const clipIdCollision =
                getTrackStoreState()?.tracks.some((track) =>
                    track.clips.some((clip) => clip.id === state.generatedClipId)
                ) ?? true;
            if (clipIdCollision) {
                return { status: 'conflict' };
            }
            const replayedClip = transactionScope(() => {
                const createdClip = addClip({
                    id: state.generatedClipId,
                    trackId: state.sourceTrackId,
                    startBeat: generatedClip.startBeat,
                    endBeat: generatedClip.endBeat,
                    name: generatedClip.name,
                    type: 'midi',
                });
                if (!createdClip || createdClip.id !== state.generatedClipId) {
                    return null;
                }
                setNotesForClip(
                    createdClip.id,
                    state.resultNotes.map((note) => ({ ...note }))
                );
                return createdClip;
            });
            if (!replayedClip) {
                return { status: 'conflict' };
            }
            return createWrittenResult({
                direction,
                noteCount: state.resultNotes.length,
                isDurable: () =>
                    hasDurableMidiGenerationResult({
                        trackId: state.sourceTrackId,
                        clip: generatedClip,
                        notes: state.resultNotes,
                        noteMatch: 'exact',
                    }),
            });
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
                    id: state.generatedClipId,
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
            state.generatedClipId = completedClip.id;
            state.generatedClipInverse.clipId = completedClip.id;
            state.generatedClip = {
                id: completedClip.id,
                name: completedClip.name,
                startBeat: completedClip.startBeat,
                endBeat: completedClip.endBeat,
                type: completedClip.type,
            };
            const committedGeneratedClip = state.generatedClip;
            state.resultNotes.splice(0, state.resultNotes.length, ...writtenNotes.map((note) => ({ ...note })));
            const replayOperation = state.redoAction.payload.operation;
            if (replayOperation.kind === 'create-clip') {
                replayOperation.targetTrackId = state.sourceTrackId;
                replayOperation.clip = {
                    id: completedClip.id,
                    trackId: state.sourceTrackId,
                    name: completedClip.name,
                    startBeat: completedClip.startBeat,
                    endBeat: completedClip.endBeat,
                    type: 'midi',
                };
            }
            populateGeneratedMidiStateGuard({
                guard: state.generatedClipInverse.generatedMidiStateGuard,
                entity: completedClip,
                clipIds: [completedClip.id],
            });
            state.materialized = true;

            return createWrittenResult({
                direction,
                noteCount: writtenNotes.length,
                isDurable: () =>
                    hasDurableMidiGenerationResult({
                        trackId: state.sourceTrackId,
                        clip: committedGeneratedClip,
                        notes: state.resultNotes,
                        noteMatch: 'exact',
                    }),
            });
        }

        const writtenNotes: Array<ReturnType<typeof addMidiNote>> = [];
        transactionScope(() => {
            for (const note of notes) {
                writtenNotes.push(
                    addMidiNote(alpha.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100)
                );
            }
        });
        state.resultNotes.splice(
            0,
            state.resultNotes.length,
            ...state.sourceNotes.map((note) => ({ ...note })),
            ...writtenNotes.map((note) => ({ ...note }))
        );
        state.materialized = true;

        return createWrittenResult({
            direction,
            noteCount: writtenNotes.length,
            isDurable: () => hasExactSourceResult(state, state.resultNotes),
        });
    },
    describe: (action) => {
        const source = createMidiGenerationSourceGuard(action.payload.clipId);
        if (!source) {
            return { label: 'AI: complete MIDI phrase', inverseAction: null };
        }
        const state = ensureCompleteMidiState(action, source);
        if (action.payload.direction === 'backward') {
            return {
                label: 'AI: complete MIDI phrase',
                inverseAction: { type: 'discardDuplicatedClip', payload: state.generatedClipInverse },
                redoAction: state.redoAction,
            };
        }
        return {
            label: 'AI: complete MIDI phrase',
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: state.sourceNotes,
                    expectedNotes: state.resultNotes,
                },
            },
            redoAction: state.redoAction,
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
