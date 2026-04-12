/**
 * In-memory clipboard state for clip and note copy/paste operations.
 */

import { createStore } from '#/infra/store/createStore';
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

export type ClipboardState = {
    clipClipboard: ClipboardEntry[];
    noteClipboard: NoteClipboardEntry | null;
};

export const clipboardStore = createStore<ClipboardState>({
    initialData: {
        clipClipboard: [],
        noteClipboard: null,
    },
});

export function setClipClipboard(entries: ClipboardEntry[]): void {
    const current = clipboardStore.value;
    clipboardStore.set({
        clipClipboard: entries,
        noteClipboard: current?.noteClipboard ?? null,
    });
}

export function setNoteClipboard(entry: NoteClipboardEntry | null): void {
    const current = clipboardStore.value;
    clipboardStore.set({
        clipClipboard: current?.clipClipboard ?? [],
        noteClipboard: entry,
    });
}
