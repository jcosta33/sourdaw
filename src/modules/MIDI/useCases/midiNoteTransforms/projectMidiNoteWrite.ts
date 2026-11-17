import { type AppAction } from '#/utils/handlerContract';

import { planGuardedMidiNoteEdits } from '../../services/planGuardedMidiNoteEdits';
import { isMaterializedAddNotesArguments } from '../../transformers/isMaterializedAddNotesArguments';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';
import { isRestoreMidiClipNotesReplayArguments } from '../../transformers/isRestoreMidiClipNotesReplayArguments';

import { getRestoreMidiClipNotesStatus } from './getRestoreMidiClipNotesStatus';

type NoteWrite = Extract<AppAction, { type: 'addNotes' | 'editMidiNotes' | 'restoreMidiClipNotes' }>;
type NoteBucket = { present: boolean; value: readonly unknown[] };

/** Project the three explicit note writes, preserving the presence of an empty notes bucket. */
export function projectMidiNoteWrite(
    action: NoteWrite,
    clipId: string,
    bucket: NoteBucket,
    strict = false
): NoteBucket | null {
    if (action.payload.clipId !== clipId) {
        return bucket;
    }
    if (action.type === 'editMidiNotes') {
        const edit = planGuardedMidiNoteEdits(action.payload, bucket);
        return edit ? { present: edit.beforePresent || !edit.isNoop, value: edit.notes } : null;
    }
    if (action.type === 'addNotes') {
        const { notes } = action.payload;
        if (Array.isArray(notes) && notes.length === 0) {
            return bucket;
        }
        if (!isMaterializedAddNotesArguments(action.payload)) {
            return null;
        }
        const value = [...bucket.value, ...action.payload.notes];
        return !strict || isMidiNoteSnapshot(value) ? { present: true, value } : null;
    }

    const { payload } = action;
    if (!isRestoreMidiClipNotesReplayArguments(payload)) {
        return null;
    }
    if (
        strict &&
        (!isMidiNoteSnapshot(bucket.value) ||
            getRestoreMidiClipNotesStatus({
                ...payload,
                projectedNotes: bucket.value,
                projectedNotesBucketPresent: bucket.present,
            }) === 'conflict')
    ) {
        return null;
    }
    if (payload.notesBucketPresent === false) {
        return { present: false, value: [] };
    }
    if (payload.notesBucketPresent === undefined && !bucket.present && payload.notes.length === 0) {
        return bucket;
    }
    return { present: true, value: payload.notes };
}
