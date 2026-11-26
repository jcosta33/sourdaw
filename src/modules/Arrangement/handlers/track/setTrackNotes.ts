import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { MAX_TRACK_NOTES_LENGTH } from '#/utils/trackNotesLimits';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackNotes } from '../../useCases/setTrackGainPan/setTrackNotes';

import { isSetTrackNotesSessionEntry } from './isSetTrackNotesSessionEntry';
import { describeMissingTrack, readPlannedDisplayTrack } from './readPlannedDisplayTrack';

type SetTrackNotesAction = Extract<AppAction, { type: 'setTrackNotes' }>;

function findRefusal(action: SetTrackNotesAction, context: HandlerValidationContext): string | null {
    const { trackId, notes, expectedNotes } = action.payload;
    const track = readPlannedDisplayTrack(trackId, context);
    if (track === null) {
        return describeMissingTrack(trackId);
    }
    // Only a fresh write is bounded: a restore puts back notes a saved project already held.
    if (expectedNotes === undefined && notes.length > MAX_TRACK_NOTES_LENGTH) {
        return `Track notes are limited to ${MAX_TRACK_NOTES_LENGTH} characters`;
    }
    return expectedNotes === undefined || track.notes === expectedNotes
        ? null
        : `Track "${trackId}" notes were edited after the edit this restores`;
}

function readLiveNotes(trackId: string): string | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.notes;
}

export const handleSetTrackNotes = createHandler<'setTrackNotes'>({
    // Only a restore guarded by the notes it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload.expectedNotes !== undefined,
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    validateSessionEntry: isSetTrackNotesSessionEntry,
    isNoop: (action) => {
        const notes = readLiveNotes(action.payload.trackId);
        return notes === action.payload.notes && (action.payload.expectedNotes ?? notes) === notes;
    },
    execute: (action) => {
        const { trackId, notes, expectedNotes } = action.payload;
        if (expectedNotes !== undefined && readLiveNotes(trackId) !== expectedNotes) {
            return { status: 'conflict' };
        }
        setTrackNotes(trackId, notes);
        return { status: 'written' };
    },
    describe: (alpha, context) => {
        // The inverse restores the notes this action finds, as earlier actions of its batch leave them.
        // Both legs name the notes they expect, so a later edit conflicts instead of being overwritten.
        const { trackId, notes } = alpha.payload;
        const prev = readPlannedDisplayTrack(trackId, context);
        // A batch describes every action before executing any, so a missing track is refused here with its reason.
        if (!prev && context) {
            throw new Error(describeMissingTrack(trackId));
        }
        const label = 'Set track notes';
        if (!prev) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'setTrackNotes',
                payload: { trackId: prev.id, notes: prev.notes, expectedNotes: notes },
            },
            redoAction: {
                type: 'setTrackNotes',
                payload: { trackId: prev.id, notes, expectedNotes: prev.notes },
            },
        };
    },
    undoable: true,
});
