import { midiStore } from '#/modules/MIDI/stores';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { clipboardStore } from '../../stores/clipboardStore';

export function pasteNotes(clipId: string, beatOffset: number): void {
    const noteClipboard = clipboardStore.value?.noteClipboard ?? null;
    if (!noteClipboard || noteClipboard.notes.length === 0) {
        return;
    }

    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.notesByClipId[clipId] ?? [];

    let minStart = Infinity;
    for (const n of noteClipboard.notes) {
        if (n.startBeat < minStart) {
            minStart = n.startBeat;
        }
    }

    const pastedNotes: MidiNote[] = noteClipboard.notes.map((n) => ({
        ...n,
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        startBeat: n.startBeat - minStart + beatOffset,
    }));

    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, ...pastedNotes],
        },
    });
}
