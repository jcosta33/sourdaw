import { createHandler } from '#/utils/createHandler';

import { normalizeMidiNoteInput } from '../../transformers/normalizeMidiNoteInput';
import { batchAddMidiNotes } from '../../useCases/midiNoteCrud/batchAddMidiNotes';
import { getMidiClipNotesSnapshot } from '../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';

type AddNotesAction = {
    payload: {
        notes: Array<{ id?: string; pitch: number; startBeat: number; duration: number; velocity?: number }>;
    };
};

type MaterializedNote = ReturnType<typeof normalizeMidiNoteInput>;

const notesByAction = new WeakMap<object, MaterializedNote[]>();

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

export const handleAddNotes = createHandler<'addNotes'>({
    execute: (action) => {
        batchAddMidiNotes(action.payload.clipId, getMaterializedNotes(action));
    },
    describe: (action) => {
        const label = `Add ${action.payload.notes.length} MIDI note${action.payload.notes.length === 1 ? '' : 's'}`;
        const noteSnapshot = getMidiClipNotesSnapshot(action.payload.clipId);
        const notes = noteSnapshot ?? [];
        if (action.payload.notes.length === 0) {
            return { label, inverseAction: null };
        }

        const addedNotes = getMaterializedNotes(action);
        const expectedNotes = [...notes, ...addedNotes];

        return {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: { clipId: action.payload.clipId, notes, expectedNotes },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: expectedNotes,
                    expectedNotes: notes,
                    allowMissingExpectedEmpty: noteSnapshot === null,
                },
            },
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
