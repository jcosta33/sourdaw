import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { normalizeMidiNoteInput } from '../../transformers/normalizeMidiNoteInput';
import { batchAddMidiNotes } from '../../useCases/midiNoteCrud/batchAddMidiNotes';
import { getMidiClipNotesSnapshot } from '../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';

import { isAddNotesSessionEntry } from './isAddNotesSessionEntry';
import { isMaterializedAddNotesArguments } from './isMaterializedAddNotesArguments';

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

function isUnlockedMidiClipProducer(
    action: AppAction,
    clipId: string
): action is Extract<AppAction, { type: 'addClip' }> {
    return (
        action.type === 'addClip' &&
        action.payload.id === clipId &&
        action.payload.type === 'midi' &&
        action.payload.locked !== true
    );
}

function getEarlierUnlockedMidiClipProducer(
    clipId: string,
    context: HandlerValidationContext
): Extract<AppAction, { type: 'addClip' }> | null {
    for (let index = context.actionIndex - 1; index >= 0; index -= 1) {
        const action = context.actions[index];
        if (action && isUnlockedMidiClipProducer(action, clipId)) {
            return action;
        }
    }
    return null;
}

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

function getBatchLocalWritableMidiClipReplayGuard(clipId: string, context: HandlerValidationContext | undefined) {
    if (!context) {
        return null;
    }
    const clipProducer = getEarlierUnlockedMidiClipProducer(clipId, context);
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
    const trackProducer = context.actions
        .slice(0, context.actionIndex)
        .find(
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

function getWritableMidiClipReplayGuardForBatch(clipId: string, context: HandlerValidationContext | undefined) {
    return getWritableMidiClipReplayGuard(clipId) ?? getBatchLocalWritableMidiClipReplayGuard(clipId, context);
}

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
        if (action.type !== 'addNotes' || action.payload.clipId !== clipId) {
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
        if (getWritableMidiClipReplayGuard(action.payload.clipId) === null || !hasDistinctMaterializedNoteIds(action)) {
            return { status: 'conflict' };
        }
        batchAddMidiNotes(action.payload.clipId, getMaterializedNotes(action));
        return undefined;
    },
    validate: (action, context) =>
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
