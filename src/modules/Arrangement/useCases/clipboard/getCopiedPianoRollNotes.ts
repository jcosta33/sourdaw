import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { clipboardStore } from '../../stores/clipboardStore';

/** Read the shared note clipboard for a destination take's insertion route. */
export function getCopiedPianoRollNotes(): readonly MidiNote[] {
    return clipboardStore.value?.noteClipboard?.notes ?? [];
}
