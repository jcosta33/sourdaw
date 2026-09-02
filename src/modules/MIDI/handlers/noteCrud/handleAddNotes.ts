import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

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

function getBatchLocalWritableMidiClipReplayGuard(
    clipId: string,
    context: HandlerValidationContext | undefined
) {
    if (!context) {
        return null;
    }
    const clipProducer = context.actions
        .slice(0, context.actionIndex)
        .findLast(
            (action) =>
                action.type === 'addClip' &&
                action.payload.id === clipId &&
                action.payload.type === 'midi' &&
                action.payload.locked !== true
        );
    if (!clipProducer) {
        return null;
    }
    const trackId = clipProducer.payload.trackId;
    const existingTrack = trackStore.value?.tracks.find((track) => track.id === trackId);
    if (existingTrack && existingTrack.frozen !== true) {
        return {
            trackId,
            expectedTrackFrozen: false,
            expectedClipLocked: false,
        };
    }
    const trackProducer = context.actions.slice(0, context.actionIndex).find(
        (action) => action.type === 'addTrack' && action.payload.id === trackId && action.payload.kind === 'midi'
    );
    if (!trackProducer) {
        return null;
    }
    return {
        trackId,
        expectedTrackFrozen: false,
        expectedClipLocked: false,
    };
}

function getWritableMidiClipReplayGuardForBatch(
    clipId: string,
    context: HandlerValidationContext | undefined
) {
    return getWritableMidiClipReplayGuard(clipId) ?? getBatchLocalWritableMidiClipReplayGuard(clipId, context);
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

function hasDistinctMaterializedNoteIds(action: AddNotesAction): boolean {
    const materializedNotes = getMaterializedNotes(action);
    const materializedIds = materializedNotes.map((note) => note.id);
    if (new Set(materializedIds).size !== materializedIds.length) {
        return false;
    }
    const existingNoteIds = new Set((getMidiClipNotesSnapshot(action.payload.clipId) ?? []).map((note) => note.id));
    return materializedIds.every((id) => !existingNoteIds.has(id));
}

export const handleAddNotes = createHandler<'addNotes'>({
    materializeCommandArguments: (action) => {
        const notes = getMaterializedNotes(action);
        action.payload.notes = notes;
    },
    execute: (action) => {
        if (getWritableMidiClipReplayGuard(action.payload.clipId) === null || !hasDistinctMaterializedNoteIds(action)) {
            return { status: 'conflict' };
        }
        batchAddMidiNotes(action.payload.clipId, getMaterializedNotes(action));
        return undefined;
    },
    validate: (action, context) =>
        getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context) !== null &&
        hasDistinctMaterializedNoteIds(action),
    describe: (action, context) => {
        const label = `Add ${action.payload.notes.length} MIDI note${action.payload.notes.length === 1 ? '' : 's'}`;
        const noteSnapshot = getMidiClipNotesSnapshot(action.payload.clipId);
        const notes = noteSnapshot ?? [];
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
                payload: { clipId: action.payload.clipId, notes, expectedNotes, noteTransformReplayGuard },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: action.payload.clipId,
                    notes: expectedNotes,
                    expectedNotes: notes,
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
