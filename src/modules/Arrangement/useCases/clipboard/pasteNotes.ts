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
    for (const node of noteClipboard.notes) {
        if (node.startBeat < minStart) {
            minStart = node.startBeat;
        }
    }

    const pastedNotes: MidiNote[] = noteClipboard.notes.map((node) => ({
        ...node,
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        startBeat: node.startBeat - minStart + beatOffset,
    }));

    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, ...pastedNotes],
        },
    });
}
