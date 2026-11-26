import { type AppAction } from '#/utils/handlerContract';
import { DEFAULT_NOTE_VELOCITY } from '#/utils/midiData';

import { type ProjectContext } from '../../models/ProjectContext';
import { findContextClip } from '../../transformers/findContextClip';

type EditAction = Extract<AppAction, { type: 'editMidiNotes' }>;
const DETAILS_LIMIT = 6;

export function describeMidiNoteEdit(action: EditAction, context: ProjectContext): string {
    const { clipId, guard, operations } = action.payload;
    const clipName = findContextClip(context, clipId)?.name ?? clipId;
    const notes = new Map(guard.expectedNotes.map((note) => [note.id, note]));
    const details = operations.slice(0, DETAILS_LIMIT).map((operation) => {
        if (operation.type === 'insert') {
            return `insert pitch ${operation.note.pitch} at beat ${operation.note.startBeat}, length ${operation.note.duration} beats, velocity ${operation.note.velocity ?? DEFAULT_NOTE_VELOCITY}`;
        }
        const note = notes.get(operation.noteId);
        const at = note ? `pitch ${note.pitch} at beat ${note.startBeat}` : operation.noteId;
        if (operation.type === 'delete') {
            return `remove ${at}`;
        }
        const patch = operation.patch;
        const changes = [
            patch.pitch === undefined ? null : `pitch ${patch.pitch}`,
            patch.startBeat === undefined ? null : `beat ${patch.startBeat}`,
            patch.duration === undefined ? null : `length ${patch.duration} beats`,
            patch.velocity === undefined ? null : `velocity ${patch.velocity}`,
        ].filter((field) => field !== null);
        return `change ${at} to ${changes.join(', ')}`;
    });
    if (operations.length > DETAILS_LIMIT) {
        details.push(`${operations.length - DETAILS_LIMIT} more note edits`);
    }
    return `Edit MIDI notes in ${clipName} (${details.join(' • ')})`;
}
