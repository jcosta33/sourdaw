import { getNotesForClip } from './midiNoteCrud/getNotesForClip';
import { setNotesForClip } from './midiNoteCrud/setNotesForClip';
import { projectStore } from '#/modules/Project';
import { quantizeMidiNoteToScale } from '#/utils/Music/MusicalScale';

export function snapClipToScale(clipId: string): void {
    const project = projectStore.value;
    if (!project) return;

    const notes = getNotesForClip(clipId);
    const updatedNotes = notes.map((note) => ({
        ...note,
        pitch: quantizeMidiNoteToScale(note.pitch, project.keyRoot, project.scaleName),
    }));

    setNotesForClip(clipId, updatedNotes);
}
