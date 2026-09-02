import { trackStore } from '#/modules/Arrangement/stores';
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

function getWritableMidiClipReplayGuard(clipId: string) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!track || !clip || clip.type !== 'midi' || track.frozen === true || clip.locked === true) {
        return null;
    }
    return {
        trackId: track.id,
        expectedTrackFrozen: false,
        expectedClipLocked: false,
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

export const handleAddNotes = createHandler<'addNotes'>({
    materializeCommandArguments: (action) => {
        const notes = getMaterializedNotes(action);
        action.payload.notes = notes;
    },
    execute: (action) => {
        if (getWritableMidiClipReplayGuard(action.payload.clipId) === null) {
            return { status: 'conflict' };
        }
        batchAddMidiNotes(action.payload.clipId, getMaterializedNotes(action));
        return undefined;
    },
    describe: (action) => {
        const label = `Add ${action.payload.notes.length} MIDI note${action.payload.notes.length === 1 ? '' : 's'}`;
        const noteSnapshot = getMidiClipNotesSnapshot(action.payload.clipId);
        const notes = noteSnapshot ?? [];
        if (action.payload.notes.length === 0) {
            return { label, inverseAction: null };
        }
        const noteTransformReplayGuard = getWritableMidiClipReplayGuard(action.payload.clipId);
        if (noteTransformReplayGuard === null) {
            return { label, inverseAction: null };
        }

        const addedNotes = getMaterializedNotes(action);
        const expectedNotes = [...notes, ...addedNotes];

        return {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: { clipId: action.payload.clipId, notes, expectedNotes, noteTransformReplayGuard },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: expectedNotes,
                    expectedNotes: notes,
                    allowMissingExpectedEmpty: noteSnapshot === null,
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
