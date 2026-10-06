import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { isMaterializedAddNotesArguments } from '../../transformers/isMaterializedAddNotesArguments';
import { normalizeMidiNoteInput } from '../../transformers/normalizeMidiNoteInput';
import { batchAddMidiNotes } from '../../useCases/midiNoteCrud/batchAddMidiNotes';
import { getMidiClipNotesSnapshot } from '../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { isAddNotesSessionEntry } from './isAddNotesSessionEntry';

type AddNotesAction = {
    payload: {
        clipId: string;
        notes: Array<{ id?: string; pitch: number; startBeat: number; duration: number; velocity?: number }>;
    };
};

type MaterializedNote = ReturnType<typeof normalizeMidiNoteInput>;

type MidiNotesBucketSnapshot = {
    notes: MaterializedNote[];
    present: boolean;
};

const notesByAction = new WeakMap<object, MaterializedNote[]>();

function getMidiNotesBucketSnapshot(clipId: string): MidiNotesBucketSnapshot {
    const state = midiStore.value;
    return {
        notes: (getMidiClipNotesSnapshot(clipId) ?? []).map((note) => ({ ...note })),
        present: Object.hasOwn(state?.notesByClipId ?? {}, clipId),
    };
}

function getMaterializedNotes(action: AddNotesAction): MaterializedNote[] {
    const existingNotes = notesByAction.get(action);
    if (existingNotes) {
        return existingNotes;
    }

    const notes = action.payload.notes.map((note) =>
        normalizeMidiNoteInput({
            ...note,
            id: note.id ?? `note-${crypto.randomUUID()}`,
        })
    );
    notesByAction.set(action, notes);
    return notes;
}

function getBatchMidiNotesBucketSnapshot(
    clipId: string,
    context: HandlerValidationContext | undefined
): MidiNotesBucketSnapshot {
    const snapshot = getMidiNotesBucketSnapshot(clipId);
    if (!context) {
        return snapshot;
    }
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (
            action.type !== 'addNotes' ||
            action.payload.clipId !== clipId ||
            !isMaterializedAddNotesArguments(action.payload)
        ) {
            continue;
        }
        snapshot.notes.push(...getMaterializedNotes(action));
        snapshot.present = true;
    }
    return snapshot;
}

function hasDistinctMaterializedNoteIds(action: AddNotesAction, context?: HandlerValidationContext): boolean {
    const materializedNotes = getMaterializedNotes(action);
    const materializedIds = materializedNotes.map((note) => note.id);
    if (new Set(materializedIds).size !== materializedIds.length) {
        return false;
    }
    const existingNoteIds = new Set(
        getBatchMidiNotesBucketSnapshot(action.payload.clipId, context).notes.map((note) => note.id)
    );
    return materializedIds.every((id) => !existingNoteIds.has(id));
}

export const handleAddNotes = createHandler<'addNotes'>({
    validateSessionEntry: isAddNotesSessionEntry,
    validateMaterializedCommandArguments: isMaterializedAddNotesArguments,
    materializeCommandArguments: (action) => {
        const notes = getMaterializedNotes(action);
        action.payload.notes = notes;
    },
    execute: (action) => {
        if (
            !isMaterializedAddNotesArguments(action.payload) ||
            getWritableMidiClipReplayGuardForBatch(action.payload.clipId) === null ||
            !hasDistinctMaterializedNoteIds(action)
        ) {
            return { status: 'conflict' };
        }
        batchAddMidiNotes(action.payload.clipId, getMaterializedNotes(action));
        return undefined;
    },
    validate: (action, context) =>
        (action.payload.notes.length === 0 || isMaterializedAddNotesArguments(action.payload)) &&
        getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context) !== null &&
        hasDistinctMaterializedNoteIds(action, context),
    describe: (action, context) => {
        const label = `Add ${action.payload.notes.length} MIDI note${action.payload.notes.length === 1 ? '' : 's'}`;
        const noteSnapshot = getBatchMidiNotesBucketSnapshot(action.payload.clipId, context);
        const notes = noteSnapshot.notes;
        if (action.payload.notes.length === 0) {
            return { label, inverseAction: null };
        }
        const noteTransformReplayGuard = getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context);
        if (noteTransformReplayGuard === null) {
            return { label, inverseAction: null };
        }

        const addedNotes = getMaterializedNotes(action);
        const expectedNotes = [...notes, ...addedNotes];

        return {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes,
                    expectedNotes,
                    notesBucketPresent: noteSnapshot.present,
                    expectedNotesBucketPresent: true,
                    noteTransformReplayGuard,
                },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: expectedNotes,
                    expectedNotes: notes,
                    notesBucketPresent: true,
                    expectedNotesBucketPresent: noteSnapshot.present,
                    noteTransformReplayGuard,
                },
            },
        };
    },
    undoable: true,
    isNoop: (action) => action.payload.notes.length === 0,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
