/**
 * In-memory clipboard state for clip and note copy/paste operations.
 */

import { type Clip } from '../models/Track';
import { type MidiNote } from '../models/MidiNoteViewTypes';

export type ClipboardEntry = {
    clip: Clip;
    midiNotes?: MidiNote[];
    sourceTrackId: string;
};

export type NoteClipboardEntry = {
    notes: MidiNote[];
};

export let clipClipboard: ClipboardEntry[] = [];
export let noteClipboard: NoteClipboardEntry | null = null;

export function setClipClipboard(entries: ClipboardEntry[]): void {
    clipClipboard = entries;
}

export function setNoteClipboard(entry: NoteClipboardEntry | null): void {
    noteClipboard = entry;
}
