import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { generateToolCalls } from '#/modules/AiRuntime/useCases';
import { createMidiNote, setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createMidiGenerationSourceGuard } from './createMidiGenerationSourceGuard';
import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';
import { llmGenerateNotes } from './llmNoteHelpers';

type VariationMidiAction = Extract<AppAction, { type: 'variationMidi' }>;
type MidiGenerationSource = NonNullable<ReturnType<typeof createMidiGenerationSourceGuard>>;

type VariationMidiState = {
    sourceTrackId: string;
    sourceClip: MidiGenerationSource['clip'];
    sourceNotes: MidiClipNoteSnapshot[];
    isOriginalSourceCurrent: () => boolean;
    resultNotes: MidiClipNoteSnapshot[];
    materialized: boolean;
};

const variationMidiStates = new WeakMap<VariationMidiAction, VariationMidiState>();

function ensureVariationMidiState(action: VariationMidiAction, source: MidiGenerationSource): VariationMidiState {
    const existing = variationMidiStates.get(action);
    if (existing) {
        return existing;
    }
    const state: VariationMidiState = {
        sourceTrackId: source.trackId,
        sourceClip: { ...source.clip },
        sourceNotes: source.notes.map((note) => ({ ...note })),
        isOriginalSourceCurrent: source.isCurrent,
        resultNotes: [],
        materialized: false,
    };
    variationMidiStates.set(action, state);
    return state;
}

function hasExactResult(state: VariationMidiState, notes: readonly MidiClipNoteSnapshot[]): boolean {
    return hasDurableMidiGenerationResult({
        trackId: state.sourceTrackId,
        clip: state.sourceClip,
        notes,
        noteMatch: 'exact',
    });
}

function createWrittenResult(state: VariationMidiState) {
    const logSuccess = (): void => {
        logger.info(
            `[AI MIDI] Generated variation with ${String(state.resultNotes.length)} notes (replaced ${String(state.sourceNotes.length)} existing)`
        );
    };
    return {
        status: 'written' as const,
        afterCommit: logSuccess,
        afterAmbiguousCommit: () => {
            if (hasExactResult(state, state.resultNotes)) {
                logSuccess();
            }
        },
    };
}

export const handleVariationMidi = createHandler<'variationMidi'>({
    execute: async (alpha) => {
        const existingState = variationMidiStates.get(alpha);
        const source = createMidiGenerationSourceGuard(alpha.payload.clipId);
        if (!source) {
            if (existingState?.materialized) {
                return { status: 'conflict' };
            }
            notifyUser('MIDI variation failed: source clip not found', 'error');
            return { status: 'no-write' };
        }

        const amount = alpha.payload.amount ?? 0.3;
        const state = ensureVariationMidiState(alpha, source);
        const transactionScope = captureAutomergeStorageTransactionScope();

        if (state.materialized) {
            if (hasExactResult(state, state.resultNotes)) {
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
            return createWrittenResult(state);
        }

        const pct = Math.round(amount * 100);
        const instruction = `Create a variation of these notes. Change ~${String(pct)}% of them — alter some pitches, shift some rhythms, or change velocities, but keep the overall feel and key. Output the COMPLETE set of notes for the clip (replacing all existing notes). The variation should sound like a B-section or alternate take.`;

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
        state.resultNotes.splice(0, state.resultNotes.length, ...newNotes.map((note) => ({ ...note })));
        state.materialized = true;
        transactionScope(() => {
            setNotesForClip(
                alpha.payload.clipId,
                state.resultNotes.map((note) => ({ ...note }))
            );
        });

        return createWrittenResult(state);
    },
    describe: (action) => {
        const source = createMidiGenerationSourceGuard(action.payload.clipId);
        if (!source) {
            return { label: 'AI: create MIDI variation', inverseAction: null };
        }
        const state = ensureVariationMidiState(action, source);
        return {
            label: 'AI: create MIDI variation',
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: state.sourceNotes,
                    expectedNotes: state.resultNotes,
                },
            },
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
