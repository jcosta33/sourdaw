import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { MAX_TRACK_NOTES_LENGTH } from '#/utils/trackNotesLimits';

type NotesPayload = { trackId: string; notes: string; expectedNotes?: string };

function readNotesPayload(action: HandlerSessionActionEntry['action'] | undefined): NotesPayload | null {
    return action?.type === 'setTrackNotes' ? action.payload : null;
}

function areLegsGuardedReversals(forward: NotesPayload, inverse: NotesPayload, redo: NotesPayload): boolean {
    if (inverse.expectedNotes === undefined || redo.expectedNotes === undefined) {
        return false;
    }
    return (
        inverse.trackId === forward.trackId &&
        redo.trackId === forward.trackId &&
        inverse.expectedNotes === forward.notes &&
        redo.notes === forward.notes &&
        redo.expectedNotes === inverse.notes
    );
}

/**
 * A saved notes edit is replayable only when its undo restores the notes the edit found, guarded by
 * the notes the edit left, and its redo is that restore reversed, all on the one track. An unguarded
 * leg would overwrite a newer edit on replay, a leg naming another track would write notes the action
 * never touched, and notes beyond the limit are no notes the project can hold.
 */
export function isSetTrackNotesSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const forward = readNotesPayload(entry.action);
    if (forward === null || forward.notes.length > MAX_TRACK_NOTES_LENGTH) {
        return false;
    }
    if (entry.inverseAction === null) {
        return entry.redoAction === undefined;
    }
    const inverse = readNotesPayload(entry.inverseAction);
    const redo = readNotesPayload(entry.redoAction);
    if (inverse === null || redo === null || inverse.notes.length > MAX_TRACK_NOTES_LENGTH) {
        return false;
    }
    return areLegsGuardedReversals(forward, inverse, redo);
}
