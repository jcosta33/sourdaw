import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type RestorePayload = Extract<AppAction, { type: 'restoreMidiClipNotes' }>['payload'];

type MidiNoteTransformSessionEntryInput = {
    entry: HandlerSessionActionEntry;
    clipId: string;
    transform: (notes: readonly MidiNote[]) => MidiNote[];
};

function hasSnapshots(payload: RestorePayload, clipId: string): boolean {
    return payload.clipId === clipId && isMidiNoteSnapshot(payload.notes) && isMidiNoteSnapshot(payload.expectedNotes);
}

function isWritableGuard(guard: RestorePayload['noteTransformReplayGuard']): boolean {
    return guard !== undefined && guard.expectedTrackFrozen === false && guard.expectedClipLocked === false;
}

function isGuardedPair(inverse: RestorePayload, redo: RestorePayload): boolean {
    return (
        isWritableGuard(inverse.noteTransformReplayGuard) &&
        isWritableGuard(redo.noteTransformReplayGuard) &&
        inverse.noteTransformReplayGuard?.trackId === redo.noteTransformReplayGuard?.trackId
    );
}

function isSwappedPair(inverse: RestorePayload, redo: RestorePayload): boolean {
    return midiNotesEqual(redo.notes, inverse.expectedNotes) && midiNotesEqual(redo.expectedNotes, inverse.notes);
}

/**
 * A saved whole-clip note transform is replayable only when its undo restores the notes the transform
 * read, guarded by exactly the notes it wrote, and its redo is that same pair swapped. The stored
 * result must be what the transform yields for the stored source, so a tampered or stale entry is
 * dropped rather than replayed, and an undo over notes edited since refuses at execution.
 */
export function isMidiNoteTransformSessionEntry({ entry, clipId, transform }: MidiNoteTransformSessionEntryInput) {
    const { inverseAction, redoAction } = entry;
    if (inverseAction?.type !== 'restoreMidiClipNotes' || redoAction?.type !== 'restoreMidiClipNotes') {
        return false;
    }
    const inverse = inverseAction.payload;
    const redo = redoAction.payload;
    if (!hasSnapshots(inverse, clipId) || !hasSnapshots(redo, clipId)) {
        return false;
    }
    return (
        isGuardedPair(inverse, redo) &&
        isSwappedPair(inverse, redo) &&
        !midiNotesEqual(inverse.notes, inverse.expectedNotes) &&
        midiNotesEqual(inverse.expectedNotes, transform(inverse.notes))
    );
}
